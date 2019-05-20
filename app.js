/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
// Use express module
const express = require('express');
const S = require('string');
const mysql = require('mysql');
const redis = require('redis');
const rejson = require('redis-rejson');
const utf8 = require('utf8');
const moment = require('moment');
const multer = require('multer'); // Use multer module to uploading files and parser request
// const mysqldump = require('mysqldump')
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const request = require('request');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');
const env = require('./config/s3.key'); //  引入 s3 server 設定
const sqlEnv = require('./config/mysql.key.js'); // 引入 mysql server 設定

const app = express();

app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false })); // 解析request.body content, 解析完之後在傳送到另外一端
app.use(express.static('uploads')); // 網頁圖片路徑
app.use(express.static('public'));


// listen 4001 port!!
app.listen('4001', () => {
  console.log('server connected on port 4001.');
});

// connected to redis and use rejson module
rejson(redis);
const client = redis.createClient(); // create the new client
client.on('connect', () => {
  console.log('Redis client connected....');
});


const db = mysql.createPool({
  connectionLimit: 100,
  host: sqlEnv.host,
  user: sqlEnv.user,
  password: sqlEnv.password,
  database: sqlEnv.database,
});

// 設定 multer-s3 資料
const s3 = new AWS.S3({ // 密碼去找 env內路徑
  accessKeyId: env.AWS_ACCESS_KEY,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  region: env.REGION,
});

const upload = multer({ // 上傳 s3 資料設定
  storage: multerS3({
    s3: s3,
    bucket: env.Bucket, // bucket 名稱
    acl: 'public-read', // 設定上傳後的允許 read
    metadata: function (req, file, cb) { 
      cb(null, {fieldName: file.fieldname});
    },
    key: function (req, file, cb) { // 上傳的檔案名稱
      cb(null, `${file.fieldname}-${Date.now()}-${file.originalname}`)
    }
  })
})


// API list
app.get('/', (req, res) => {
  res.send('Hi, Wellcome');
});

app.get('/admin/product', (req, res) => {
  res.redirect('/admin/product.html');
});

app.get('/admin/campaign', (req, res) => {
  res.redirect('/admin/campaign.html');
});

app.get('/user/signup', (req, res) => {
  res.redirect('/user/signup.html');
});

app.get('/user/signin', (req, res) => {
  res.redirect('/user/signin.html');
});

app.get('/user/profile', (req, res) => {
  res.redirect('/user/profile.html');
});

app.get('/admin/checkout', (req, res) => {
  res.redirect('/admin/checkout.html');
});

// Global variables & Call Back function:
const errorMessage = { error: 'Invalid token.' }; // error message for api reponse
const timeExpired = 3600; // access token expired time
function ResultOfProfile(id, provider, name, email, picture, res) {
  const ResultOfProfileData = {};
  ResultOfProfileData.id = id;
  ResultOfProfileData.provider = provider;
  ResultOfProfileData.name = name;
  ResultOfProfileData.email = email;
  ResultOfProfileData.picture = picture;
  res.send({ data: ResultOfProfileData });
}

function randomNumber(email) {
  let result = email;
  for (let i = 0; i < 30; i += 1) {
    const getRandomNumber = `${Math.floor(Math.random() * 10)}`;
    result += getRandomNumber;
  }
  return (result);
}

function getAccessTokenValue(email) {
  // 產生加密的accessToken
  return crypto.createHash('sha256').update(randomNumber(email)).digest('hex');
}

function getPassword(password) {
  // 將使用者密碼加密
  return crypto.createHash('sha256').update(`${password}5678`).digest('hex');
}

// 跟 tappay 請求付款, 成功後改變 product_order table's paid state.
function connectToTapPayAndChangeStatus(post, query, id, res) {
  request(post, (err, response, body) => {
    // pay-by-prime
    // console.log('1231111')
    if (err) { res.send(errorMessage); }
    const responseFromTappay = JSON.parse(body);
    // body.status = 0 , 代表成功
    if (responseFromTappay.status === 0) {
      // 將unpaid -> paid
      db.query(query, (err) => {
        if (err) throw err;
        const orderNumber = {};
        orderNumber.number = id;
        console.log('Change order status to paid!!');
        console.log('Order number : ', orderNumber);
        res.send({ data: orderNumber });
      });
    } else {
      res.send({ errorMessage }); // status code !== 0 , send error message
    }
  });
}

function InputAccessTokenToDB(query, AccessToken, id, provider, name, email, picture, res) {
  // 將 DB 內的 AccessToken 改變(更新DB 或 新增資料在DB內)
  db.query(query, (err, resultOfFbUser) => {
    if (err) throw err;
    const SigninResponse = {}; // 放傳至前端的結果用
    const user = {};
    // console.log('data stored on fb_user db: ', resultOfFbUser);
    SigninResponse.access_token = AccessToken;
    SigninResponse.access_expired = timeExpired;
    SigninResponse.user = user;
    user.id = id;
    user.provider = provider;
    user.name = name;
    user.email = email;
    user.picture = picture;
    // console.log('user profile & token add into db.');
    res.cookie('access_token', AccessToken);
    res.send({ data: SigninResponse });
  });
}

// Creat callback function for Search_db
// 1. query product table - resultsOfProduct
// 2. query colors table - resultsOfColor
// 3. query variant table  - resultsOfVariant
// 4. query image table - resultsOfImage
function getResultObj(resultsOfProduct, resultsOfColor, resultsOfVariant, resultsOfImage) {
  const result = {};
  result.id = resultsOfProduct.id;
  result.category = resultsOfProduct.category;
  result.title = resultsOfProduct.title;
  result.description = resultsOfProduct.description;
  result.price = resultsOfProduct.price;
  result.texture = resultsOfProduct.texture;
  result.wash = resultsOfProduct.wash;
  result.place = resultsOfProduct.place;
  result.note = resultsOfProduct.note;
  result.story = resultsOfProduct.story;
  result.colors = [];
  result.size = [];
  result.variants = [];
  result.main_image = resultsOfProduct.main_image;
  result.images = [];
  // insert colors into obj
  for (let i = 0; i < resultsOfColor.length; i += 1) {
    result.colors.push({ code: resultsOfColor[i].code, name: resultsOfColor[i].name });
  }
  // insert size into obj
  for (let i = 0; i < resultsOfVariant.length; i += 1) {
    result.size.push(resultsOfVariant[i].size);
  }
  // insert variant into obj
  for (let i = 0; i < resultsOfVariant.length; i += 1) {
    result.variants.push({
      color_code: resultsOfVariant[i].code,
      size: resultsOfVariant[i].size,
      stock: resultsOfVariant[i].stock,
    });
  }
  // insert image into obj
  for (let i = 0; i < resultsOfImage.length; i += 1) {
    result.images.push(resultsOfImage[i].image);
  }
  return result;
}
// function can convert value to number
const filterInt = (value) => {
  if (/^(-|\+)?(\d+|Infinity)$/.test(value)) {
    return Number(value);
  }
  return NaN;
};

function productQuery(queryString, res, paging, req) {
  // console.log('123')
  const queryResult = [];
  const querySignleResult = {};
  db.getConnection((err, connection) => {
    if (err) throw err;
    connection.query(queryString, (err, resultsOfProduct) => {
      connection.release();
      if (err) throw err;
      // console.log(resultsOfProduct.length);
      if (resultsOfProduct.length === 0) {
        res.send({ data: querySignleResult });
      }
      for (let i = 0; i < resultsOfProduct.length; i += 1) {
        let queryColors = `SELECT stylish.colors.code,stylish.colors.name FROM stylish.colors 
            LEFT JOIN stylish.variant ON stylish.variant.code = stylish.colors.code`;
        queryColors += ` WHERE stylish.variant.id = ${resultsOfProduct[i].id}`;
        queryColors += ' GROUP BY stylish.colors.code, stylish.colors.name';
        // 加上判別是否重複
        connection.query(queryColors, (err, resultsOfColor) => {
          if (err) throw err;
          const queryVariant = `SELECT stylish.variant.id, stylish.variant.code, stylish.variant.size, stylish.variant.stock FROM stylish.variant 
              WHERE stylish.variant.id = ${resultsOfProduct[i].id};`;
          connection.query(queryVariant, (err, resultsOfVariant) => {
            if (err) throw err;
            const queryImage = `SELECT stylish.image.image FROM stylish.image 
                WHERE stylish.image.product_id = ${resultsOfProduct[i].id};`;
            connection.query(queryImage, (err, resultsOfImage) => {
              if (err) throw err;
              queryResult.push(getResultObj(resultsOfProduct[i], resultsOfColor, resultsOfVariant, resultsOfImage));
              if (i === resultsOfProduct.length - 1) {
                if (paging === undefined && (req.params.category === 'all' || req.params.category === 'men' || req.params.category === 'women' || req.params.category === 'accessories')) {
                  // console.log('999', queryResult)
                  res.send({ paging: 1, data: queryResult });
                } else if (req.params.category.toLowerCase() === 'details') {
                  // console.log('json_set, id = ', resultsOfProduct[i].id);
                  client.json_set(`${resultsOfProduct[i].id}_details`, '.', JSON.stringify({ data: queryResult }), (err) => {
                    if (err) throw err;
                    console.log('id: ', resultsOfProduct[i].id, ' added into redis .. OK');
                  });
                  // console.log('123'   ,queryResult[0])
                  // console.log('888', queryResult[0])
                  res.send({ data: queryResult[0] }); // details 輸出格式非 arr in object.
                } else if (paging === undefined || resultsOfProduct.length < 6) {
                  // console.log('777', queryResult)
                  res.send({ data: queryResult });
                } else {
                  let pagingInt = filterInt(paging);
                  pagingInt += 1;
                  // console.log('666', queryResult)
                  res.send({ paging: pagingInt, data: queryResult });
                }
              }
            });
          });
        });
      } // for loop
    }); // db query
  });
}

app.get('/api/1.0/user/profile', (req, res) => {
  const accesstoken = req.headers.authorization.substring(7);
  console.log('/api/1.0/user/profile: ', 'accesstoken: ', accesstoken);
  const queryFindUser = `SELECT * FROM stylish.user WHERE access_token = '${accesstoken}'`;
  const queryFindUserFB = `SELECT * FROM stylish.fb_user WHERE access_token_fb = '${accesstoken}'`;
  // 先判斷 key 是從 Facebook or native 來的
  db.getConnection((err, connection) => {
    if (err) throw err;
    connection.query(queryFindUserFB, (errForqueryFindUserFB, resultFindUserFB) => {
      connection.release();
      // console.log('provider = fb ; ', resultFindUserFB);
      if (errForqueryFindUserFB) throw errForqueryFindUserFB;
      // console.log('resultFindUserFBLength', resultFindUserFB.length);
      if (resultFindUserFB.length === 0) { // token 非 Facebook,進一步判別是否為 Native
        connection.query(queryFindUser, (errForqueryFindUser, resultFindUser) => {
          if (errForqueryFindUser) throw errForqueryFindUser;
          // console.log('resultFindUserLength', resultFindUser.length);
          if (resultFindUser.length === 0) {
            res.send(errorMessage);
          } else {
            // console.log('queryResult', resultFindUser);
            const aa = moment(resultFindUser[0].access_expired).format('YYYY-MM-DD HH:mm:ss');
            const bb = moment().format('YYYY-MM-DD HH:mm:ss');
            const tokenExpiredChecked = moment(aa).diff(bb, 'seconds');
            // console.log('tokenExpiredChecked', tokenExpiredChecked);
            if (tokenExpiredChecked > 0) {
              console.log('native')
              ResultOfProfile(resultFindUser[0].id, 'native', resultFindUser[0].name, resultFindUser[0].email, '', res);
            } else {
              // console.log('token 過期');
              res.send(errorMessage);
            }
          }
        });
      } else { // Provider 為 Facebook
        ResultOfProfile(resultFindUserFB[0].fb_id, 'facebook', resultFindUserFB[0].name, resultFindUserFB[0].email, resultFindUserFB[0].picture, res);
      }
    });
  });
});

// 將產品資訊頁面加到 sql table 中
app.post('/api/1.0/admin/product', upload.fields([{ name: 'main_picture', maxCount: 1 },
  { name: 'additional_image', maxCount: 10 }]), (req, res) => {
  // store data in db
  // req.body
  const { title } = req.body;
  const { productType } = req.body;
  const { description } = req.body;
  const { price } = req.body;
  const { texture } = req.body;
  const { wash } = req.body;
  const { place } = req.body;
  const { note } = req.body;
  const { story } = req.body;
  // 以下五個資料要個別處理過
  const { color } = req.body;
  // eslint-disable-next-line camelcase
  const { color_code } = req.body;
  const { size } = req.body;
  const { stock } = req.body;
  // eslint-disable-next-line camelcase
  const { image_story } = req.body;
  // req.files
  const path = req.files.main_picture[0].key;
  const addPath = req.files.additional_image;

  // array, color/colorCode/sizeFilter/stockFilter data retrieve;
  // 將表單中空白資料去除
  const colorFilter = color.filter(word => word.length > 0);
  const colorCodeFilter = color_code.filter(word => word.length > 0);
  const sizeFilter = size.filter(word => word.length > 0);
  const stockFilter = stock.filter(word => word.length > 0);
  const imageStoryFilter = image_story.filter(word => word.length > 0);

  const queryProduct = `INSERT INTO stylish.product (title, category, description, price, texture, wash, place, note, story, main_image)
    VALUES ('${title}','${productType}', '${description}', ${price}, '${texture}',
    '${wash}', '${place}', '${note}', '${story}', concat("https://stylishstored.s3.ap-northeast-1.amazonaws.com/",'${path}') );`;
  db.getConnection((err, connection) => {
    connection.query(queryProduct, (err, result) => {
      connection.release();
      if (err) throw err;
      // console.log('data had been insert into product db');
      // retrieve the last primary key (id)
      const primaryKey = result.insertId;
      // console.log('Last record insertId: ', primaryKey);
      // insert to stylish.variant
      for (let i = 0; i < colorFilter.length; i += 1) {
        const queryVariant = `INSERT INTO stylish.variant (id, code, size, stock)
          VALUES ('${primaryKey}','${colorCodeFilter[i]}','${sizeFilter[i]}','${stockFilter[i]}');`;
        const queryColors = `INSERT INTO stylish.colors (name,code) VALUES ('${colorFilter[i]}','${colorCodeFilter[i]}')`;
        connection.query(queryVariant, (err) => {
          if (err) throw err;
          // console.log('data had been insert into vriant db');
        }); // insert to stylish.variant;

        // insert to stylish.colors
        const querySearchColor = `SELECT code FROM stylish.colors WHERE code = '${colorCodeFilter[i]}'`;
        connection.query(querySearchColor, (err, result) => {
          if (err) throw err;
          // // console.log('result length: ', result.length);
          const compareVariantColors = result.length;
          if (compareVariantColors === 0) {
            connection.query(queryColors, (err) => {
              if (err) throw err;
              // console.log('data had been insert into colors db');
            });
          } else {
            // console.log('Not insert to colors table');
          }
        }); // insert to stylish.colors;
      } // for loop;
      // data insert to Image table
      for (let i = 0; i < addPath.length; i += 1) {
        const queryImage = `INSERT INTO stylish.image (product_id,image,story) 
        VALUES ('${primaryKey}',concat("https://stylishstored.s3.ap-northeast-1.amazonaws.com/",'${addPath[i].key}') ,'${imageStoryFilter[i]}')`;
        const imageValue = [addPath, imageStoryFilter];
        connection.query(queryImage, imageValue, (err) => {
          if (err) throw err;
          if (i === (addPath.length - 1)) {
            res.send({ file: req.files, data: req.body }); // console.dir(req.body);
          }
        });
      } // for loop;
    }); // data insert to stylish.product;
  });
});

// data insert to db( campaign )table;
app.post('/api/1.0/admin/campaign', upload.single('picture'), (req, res) => {
  const productId = req.body.product_id;
  const { story } = req.body;
  const picture = req.file.key;
  // console.log('picture', picture);
  const queryString = `INSERT INTO stylish.campaign (product_id, picture, story) 
  VALUES ('${productId}', concat("https://stylishstored.s3.ap-northeast-1.amazonaws.com/",'${picture}'), '${story}');`;
  const queryAll = 'SELECT id FROM stylish.product';
  // 判斷 productId, stroty, picture 是否有空值'' or ' ' 都算
  if (S(productId).isEmpty() || S(story).isEmpty() || S(picture).isEmpty()) {
    // send error message when value is empty...
    // console.log('req.body', req.body);
    // console.log('picture', picture);
    res.send(errorMessage);
  } else {
    // list all of all product list
    db.getConnection((err, conn) => {
      if (err) throw err;
      conn.query(queryAll, (errOfQueryAll, resultAll) => {
        conn.release();
        if (errOfQueryAll) throw errOfQueryAll;
        // eslint-disable-next-line eqeqeq
        const mathchLength = resultAll.filter(word => word.id == productId).length;
        if (mathchLength !== 0) {
          // 比對輸入的 productId 存在於現有的 product table
          conn.query(queryString, (errOfQueryString, queryResultOfCampagin) => {
            if (errOfQueryString) throw errOfQueryString;
            if (queryResultOfCampagin === undefined) {
              // 表示存入失敗..
              res.send(errorMessage);
            } else {
              // console.log('queryResultOfCampagin', queryResultOfCampagin);
              // console.log('delete the redis data, key = campaigns');
              client.json_del('campaigns', (err) => {
                // delete existing cache key-pair.
                if (err) throw err;
                // console.log('the redis data, key = campaigns had been deleted...');
              });
              res.send({ body: req.body, file: req.file }); // 回傳結果... done
            }
          });
        } else {
          // 輸入的 productId 在現有的 product table 找不到..
          // console.log('The product id didn\'t exist in product table!');
          res.send(errorMessage);
        }
      });
    });
  }
});

// Insert data to db( user )table;
app.post('/api/1.0/user/signup', (req, res) => {
  const resultSignupResponse = {};
  const user = {};
  // console.log('req.body', req.body);
  // console.log('json', JSON.stringify(req.body));
  const { name } = req.body;
  const { email } = req.body;
  let { password } = req.body;
  // Create randomNumber for crypto used , 使用 (email + randomNumber) 當作 input 產生 hash value
  password = getPassword(password); // 將密碼加密後存入 db
  const accessTokenValue = getAccessTokenValue(email); // 產生變數用
  const accessExpiredValue = moment().add(timeExpired, 'seconds').format('YYYY-MM-DD HH:mm:ss'); // 時間使用 utc 標準時間, 格式轉換成 mysql 可以接受的格式
  // 產生access_expired
  // console.log('accessExpiredValue of refersh', accessExpiredValue);
  const queryInputSignup = `INSERT INTO stylish.user(name, email, password, access_token, access_expired) 
                              VALUES ('${name}', '${email}', '${password}', '${accessTokenValue}', '${accessExpiredValue}');`;
  const querySignupAll = `SELECT * FROM stylish.user WHERE email = '${email}'`;
  // Insert data into db.
  db.getConnection((err, connection) => {
    if (err) throw err;
    connection.query(querySignupAll, (err, resultSignupAll) => {
      connection.release();
      if (err) throw err;
      // console.log('test1', resultSignupAll.length);
      if (resultSignupAll.length === 0) {
        connection.query(queryInputSignup, (err, resultOfInsertDb) => {
          if (err) throw err;
          // Success Response
          resultSignupResponse.access_token = accessTokenValue;
          resultSignupResponse.access_expired = timeExpired;
          resultSignupResponse.user = user;
          user.id = resultOfInsertDb.insertId;
          user.name = name;
          user.email = email;
          user.picture = '';
          resultSignupResponse.user = user;
          res.cookie('access_token', accessTokenValue); // sned cookies to user after sign up
          // console.log('send the access_token cookies to client', accessTokenValue);
          res.send({ data: resultSignupResponse });
        });
      } else if (resultSignupAll.length !== 0) {
        // console.log('Email 已經被其他使用者註冊使用');
        res.send({ error: 'Invalid request body.' });
      }
    });
  });
}); // api for signup information;

app.post('/api/1.0/order/checkout', (req, res) => {
  // console.log('Success connect to checkout api. ');
  const accesstoken = req.headers.authorization.substring(7);
  // console.log('header:', accesstoken);
  // console.log('req.body : ', req.body);
  // console.log('JSON.stringify(req.body)', JSON.stringify(req.body))
  const primeKey = req.body.prime;
  const partnerKey = 'partner_PHgswvYEk4QY6oy3n8X3CwiQCVQmv91ZcFoD5VrkGFXo8N7BFiLUxzeG';
  const merchantId = 'AppWorksSchool_CTBC';
  const { name } = req.body.order.recipient; // cardholder required
  const phoneNumber = req.body.order.recipient.phone; // cardholder required
  const { email } = req.body.order.recipient; // cardholder required
  const { address } = req.body.order.recipient; // cardholder Bill&Shopping address
  const delivery_time = req.body.order.recipient.time; // information from stylish
  const productOrderNumber = '123';
  const { freight } = req.body.order;
  const subtotal_price = req.body.order.subtotal;
  const total_price = req.body.order.total;
  // TapPay need some information as below ::
  const sendToServerTapPay = {};
  sendToServerTapPay.prime = primeKey;
  sendToServerTapPay.partner_key = partnerKey;
  sendToServerTapPay.merchant_id = merchantId;
  sendToServerTapPay.details = 'for test only';
  sendToServerTapPay.amount = req.body.order.total;
  sendToServerTapPay.order_number = productOrderNumber;
  sendToServerTapPay.cardholder = {};
  sendToServerTapPay.cardholder.phone_number = req.body.order.recipient.phone;
  sendToServerTapPay.cardholder.name = req.body.order.recipient.name;
  sendToServerTapPay.cardholder.email = req.body.order.recipient.email;
  sendToServerTapPay.cardholder.address = req.body.order.recipient.address;
  // console.log('123', sendToServerTapPay);
  const sendToServerTapPay_json = JSON.stringify(sendToServerTapPay);
  // console.log('typeof format: ', typeof sendToServerTapPay_json);
  // 先寫入order 資訊到 order db
  // 1. 確認token , 是否已經是會員
  const queryFindUserNative = `SELECT * FROM stylish.user WHERE access_token = '${accesstoken}'`;
  const queryFindUserNativeFB = `SELECT * FROM stylish.fb_user WHERE access_token_fb = '${accesstoken}'`;
  const queryInsertToOrderDBNotMember = `INSERT INTO stylish.product_order 
    (user_information_provider,user_id,order_status, name, email, phone, address,subtotal_price,freight,total_price,time)
    VALUES ('guest','0','unpaid','${name}','${email}','${phoneNumber}','${address}',${subtotal_price},${freight},${total_price},'${delivery_time}')`;
  const queryChangePaidState = "UPDATE stylish.product_order SET order_status = 'paid';";
  // information for pay-by-prime
  const post = {
    url: 'https://sandbox.tappaysdk.com/tpc/payment/pay-by-prime',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': partnerKey,
    },
    body: sendToServerTapPay_json,
  };
  // information for pay-by-prime
  if (accesstoken.length === 0) { // accesstoken 長度 = 0 , 表示非會員
    db.getConnection((err, connection) => {
      connection.query(queryInsertToOrderDBNotMember, (err, resultOfInsertDb) => {
        connection.release();
        if (err) throw err;
        const order_id = resultOfInsertDb.insertId;
        // console.log('Provider : guess');
        connectToTapPayAndChangeStatus(post, queryChangePaidState, order_id, res);
      });
    });
  } else { // accesstoken 長度 !== 0 , 表示為會員, 下面判斷是 fb or native
    // console.log('checkout information has token number;');
    db.getConnection((err, connection) => {
      connection.query(queryFindUserNative, (err, resultOfFindUserID) => {
        connection.release();
        if (err) throw err;
        if (resultOfFindUserID.length === 0) { // provider from fb
          connection.query(queryFindUserNativeFB, (err, resultOfFindUserIDFB) => {
            if (err) throw err;
            const { fb_id } = resultOfFindUserIDFB[0];
            const queryInsertToOrderDBFB = `INSERT INTO stylish.product_order 
            (user_information_provider,user_id,order_status, name, email, phone,address,subtotal_price,freight,total_price, time)
            VALUES ('facebook','${fb_id}','unpaid','${name}','${email}','${phoneNumber}','${address}',
            ${subtotal_price},${freight},${total_price},'${delivery_time}')`;
            connection.query(queryInsertToOrderDBFB, (err, resultOfInsertDb) => {
              if (err) throw err;
              // console.log('Insert to order DB (FB), done!!');
              const order_id = resultOfInsertDb.insertId;
              // console.log('Provider : FB');
              connectToTapPayAndChangeStatus(post, queryChangePaidState, order_id, res);
            });
          });
        } else { // provider from native
          const native_id = resultOfFindUserID[0].id;
          const queryInsertToOrderDBNative = `INSERT INTO stylish.product_order 
          (user_information_provider,user_id,order_status, name, email, phone,address,subtotal_price,freight,total_price,  time)
          VALUES ('native','${native_id}','unpaid','${name}','${email}','${phoneNumber}',
          '${address}',${subtotal_price},${freight},${total_price},'${delivery_time}')`;
          connection.query(queryInsertToOrderDBNative, (err, resultOfInsertDb) => {
            if (err) throw err;
            // console.log('Insert to order DB (native), done!!');
            const order_id = resultOfInsertDb.insertId;
            // console.log('Provider : native');
            connectToTapPayAndChangeStatus(post, queryChangePaidState, order_id, res);
          });
        }
      });
    });
  }
}); // end of checkout

// api for signin information
app.post('/api/1.0/user/signin', upload.single('none'), (req, res) => {
  const { email } = req.body;
  const { provider } = req.body;
  let { password } = req.body;
  password = getPassword(password); // 將密碼加密去比對資料庫資料
  const fbAccessToken = req.body.access_token;
  const accessExpiredValue = moment().add(timeExpired, 'seconds').format('YYYY-MM-DD HH:mm:ss'); // 時間使用 utc 標準時間, 格式轉換成 mysql 可以接受的格式
  const accessTokenValue = getAccessTokenValue(email); // 產生變數用
  const queryInputSignin = `SELECT * FROM stylish.user WHERE email = '${email}' AND password = '${password}'`;
  // console.log('queryInputSignin', queryInputSignin)
  // 判斷 provider
  if (provider === 'native') {
    db.getConnection((err, connection) => {
      if (err) throw err;
      connection.query(queryInputSignin, (err, resultSigninRearch) => {
        connection.release();
        if (err) throw err;
        // console.log('123123',resultSigninRearch )
        if (resultSigninRearch.length === 0) {
          // console.log('road1')
          res.send(errorMessage);
        } else {
          // console.log('road2')

          const queryUpdateAccessTokenAndExpired = `UPDATE stylish.user
          SET access_token = '${accessTokenValue}', access_expired= '${accessExpiredValue}'
          WHERE id = ${resultSigninRearch[0].id};`;
          const nativePicture = '';
          const nativeId = resultSigninRearch[0].id;
          const nativeName = resultSigninRearch[0].name;
          InputAccessTokenToDB(queryUpdateAccessTokenAndExpired, accessTokenValue, nativeId, provider, nativeName, email, nativePicture, res);
        }
      });
    });
  } else if (provider === 'facebook') {
    // console.log('provider : FB');
    // console.log('fb token request checked ....');
    // console.log('fbAccessToken', fbAccessToken);
    // Success Response
    const requestUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${fbAccessToken}`;
    request.get(requestUrl, (err, response, body) => {
      if (err) throw err;
      const body_parser = JSON.parse(body);
      const id_fb = body_parser.id;
      const name_fb = body_parser.name;
      const email_fb = body_parser.email;
      const picture = body_parser.picture.data.url;
      const accessTokenValueFb = getAccessTokenValue(email_fb); // 產生變數用
      // console.log('error:', err);
      // console.log('statusCode:', response && response.statusCode);
      // console.log('body:', body_parser);
      // 將資料存入 fb_user 資料庫
      const queryInuptDataToFBUser = `INSERT INTO stylish.fb_user 
      (fb_id,name,email,picture,access_token_fb, access_token_local, access_expired_local) 
        VALUES ('${id_fb}','${name_fb}','${email_fb}','${picture}','${fbAccessToken}','${accessTokenValueFb}','${accessExpiredValue}');`;
      const queryFindUser = `SELECT * FROM stylish.fb_user WHERE access_token_fb = '${fbAccessToken}';`;
      const queryFindUserID = `SELECT * FROM stylish.fb_user WHERE fb_id = '${id_fb}';`;
      const queryFbTokenUpdate = `UPDATE stylish.fb_user SET access_token_fb='${fbAccessToken}' WHERE fb_id='${id_fb}';`;
      db.getConnection((err, connection) => {
        if (err) throw err;  
        connection.query(queryFindUser, (err, resultOfChecked) => { // fb_user 資料庫比對 fb token
          connection.release();
          // console.log('test1236');
          // console.log('12333333333', resultOfChecked.length)
          // console.log('123344444443', typeof resultOfChecked.length)

          if (resultOfChecked.length === 0) { // FB 資料庫比對無資料, 此狀況要進一步分析
            connection.query(queryFindUserID, (err, resultOfFindUserID) => { // 確認是 FB_ID 已經存在資料庫, 只是 token 過期
              if (err) throw err;
              // console.log('resultOfFindUserID', resultOfFindUserID);
              if (resultOfFindUserID.length === 0) { // 沒有 FB_ID and token , 判斷資料庫無任何資料, 需要新建一筆
                // console.log('test1234');
                InputAccessTokenToDB(queryInuptDataToFBUser, fbAccessToken, id_fb, provider, name_fb, email_fb, picture, res);
              } else { // 有資料, 但是token 跟資料庫不符, 將 token 在資料庫更新
                // console.log('test123222224');
                InputAccessTokenToDB(queryFbTokenUpdate, fbAccessToken, id_fb, provider, name_fb, email_fb, picture, res);
              }
            });
          } else { // FB 有資料, 直接給 FB token
            const resultSigninResponse = {}; // 放傳至前端的結果用
            const user = {};
            resultSigninResponse.access_token = resultOfChecked[0].access_token_local;
            resultSigninResponse.access_expired = timeExpired;
            resultSigninResponse.user = user;
            user.id = resultOfChecked[0].fb_id;
            user.provider = provider;
            user.name = resultOfChecked[0].name_fb;
            user.email = resultOfChecked[0].email_fb;
            user.picture = resultOfChecked[0].picture;
            // console.log('fb token is existing in db.');
            res.cookie('access_token', fbAccessToken);
            res.send({ data: resultSigninResponse });
          }
        });
      });
    }); // check user in db;
  } // 判斷 provider loop;
}); // api for signin information;


// apiVersion = 1.0
// http://[HOST_NAME]/api/[API_VERSION]/products/women
// http://[HOST_NAME]/api/[API_VERSION]/products/men?paging=1
// http://[HOST_NAME]/api/[API_VERSION]/products/search?keyword=洋裝
// http://[HOST_NAME]/api/[API_VERSION]/products/search?keyword=洋裝&paging=1
// http://[HOST_NAME]/api/[API_VERSION]/products/details?id=2
// http://localhost:3000/api/1.0/products/women?paging=1

app.get('/api/1.0/products/:category', (req, res) => {
  // 判斷數字是否為整數
  const numberOfPaging = filterInt(req.query.paging);
  const { paging } = req.query;
  // const { details } = req.query;
  const { keyword } = req.query;
  // console.log('123123',keyword)
  const id = filterInt(req.query.id);
  const category = req.params.category.toLowerCase();
  // console.log('req.query: ', req.query);
  // console.log('req.category:', category);
  // console.log('paging:', paging);
  const productCategory = ['all', 'women', 'men', 'accessories'];

  if ((productCategory.filter(word => word === category).length !== 0)) { // loop 1 started
    if (category === 'all' && paging === undefined) {
      const queryTotalProduct = 'SELECT * FROM stylish.product LIMIT 6 OFFSET 0;'; // api-key-1 && no-paging
      // console.log('test1')
      productQuery(queryTotalProduct, res, paging, req);
    } else if (category !== 'all' && paging === undefined) {
      const queryTotalProduct = `SELECT * FROM stylish.product WHERE 
      stylish.product.category = '${category}' LIMIT 6 OFFSET 0;`; // api-key-1 && no-paging
      // console.log('test2')
      productQuery(queryTotalProduct, res, paging, req);
    } else if (numberOfPaging === 0 && category === 'all') {
      const queryTotalProduct = 'SELECT * FROM stylish.product LIMIT 6 OFFSET 0;'; // api-key-1 && no-paging
      // console.log(queryTotalProduct)
      productQuery(queryTotalProduct, res, paging, req);
    } else if (numberOfPaging > 0 && category === 'all') {
      const queryTotalProduct = `SELECT * FROM stylish.product LIMIT 6 OFFSET ${6 * paging};`; // api-key-1 && no-paging
      // console.log(queryTotalProduct)
      productQuery(queryTotalProduct, res, paging, req);
    } else if (numberOfPaging === 0 && category !== 'all') {
      const queryTotalProduct = `SELECT * FROM stylish.product 
      WHERE stylish.product.category = '${category}' LIMIT 6 OFFSET 0;`; // api-key-1 && no-paging
      // console.log(queryTotalProduct)
      productQuery(queryTotalProduct, res, paging, req);
    } else if (numberOfPaging > 0 && category !== 'all') {
      const queryTotalProduct = `SELECT * FROM stylish.product WHERE stylish.product.category = 
        '${category}' LIMIT 6 OFFSET ${6 * paging};`; // api-key-1 && no-paging
      // console.log(queryTotalProduct)
      productQuery(queryTotalProduct, res, paging, req);
    } else {
      // console.log('test3')
      res.send(errorMessage); // 判斷 product list done !!
    } // end of loop 1, and next line start loop 2
  } else if (category === 'search') {
    // console.log('keyword : ', keyword)
    if (paging === undefined && keyword !== undefined && keyword !== '') {
      const querySearch = `SELECT * FROM stylish.product WHERE stylish.product.title  LIKE '%${keyword}%';`; // no paging && search
      // console.log('test4')
      productQuery(querySearch, res, paging, req);
    } else if (numberOfPaging === 0) {
      const querySearch = `SELECT * FROM stylish.product WHERE stylish.product.title  LIKE '%${keyword}%' LIMIT 6 OFFSET 0 ;`; // paging = 1 && search
      // console.log('test5')
      productQuery(querySearch, res, paging, req);
    } else if (numberOfPaging > 0) {
      const querySearch = `SELECT * FROM stylish.product 
        WHERE stylish.product.title  LIKE '%${keyword}%' LIMIT 6 OFFSET ${6 * paging} ;`; // paging > 1 && search
      // console.log('test6')
      productQuery(querySearch, res, paging, req);
    } else {
      // console.log('test7')
      res.send(errorMessage); // 判斷 product list done !!
    } // end of loop 2, and next line start loop 3
  } else if (category === 'details') {
    if (id > 0) {
      // 加入先搜尋 cache 機制
      client.json_get(`${id}_details`, (err, resultOfDetails) => {
        if (err) throw err;
        if (resultOfDetails) {
          // 讀出來的數據要在處理成 utf8 , 不然傳去前端的數據會是錯的編碼, 下面針對可能是中文的項目處理
          const decodeDetails = JSON.parse(resultOfDetails);
          decodeDetails.data[0].title = utf8.decode(decodeDetails.data[0].title);
          decodeDetails.data[0].description = utf8.decode(decodeDetails.data[0].description);
          decodeDetails.data[0].texture = utf8.decode(decodeDetails.data[0].texture);
          decodeDetails.data[0].wash = utf8.decode(decodeDetails.data[0].wash);
          decodeDetails.data[0].place = utf8.decode(decodeDetails.data[0].place);
          decodeDetails.data[0].note = utf8.decode(decodeDetails.data[0].note);
          decodeDetails.data[0].story = utf8.decode(decodeDetails.data[0].story);
          decodeDetails.data[0].colors.forEach((colors) => {
            // eslint-disable-next-line no-param-reassign
            colors.name = utf8.decode(colors.name);
          });
          // console.log('12333 ', decodeDetails.data[0]);
          res.send({ data: decodeDetails.data[0] });
        } else {
          // console.log(`redis can't found that key=${id}details `);
          const queryDetail = `SELECT * FROM stylish.product WHERE stylish.product.id = '${id}' ;`; // no paging && search
          productQuery(queryDetail, res, paging, req);
        }
      });
    } else {
      res.send(errorMessage); // 判斷 product list done !!
    }
  } // end of loop 3
});

// Marketing Campaigns API
// example: http://[HOST_NAME]/api/[API_VERSION]/marketing/campaigns
// 加入 chache 機制, 先判斷 chache 有無資料, 無資料的話會重新 query from db.
app.get('/api/1.0/marketing/campaigns', (req, res) => {
  const resultOfCampagin = [];
  const queryCampaignList = 'SELECT * FROM stylish.campaign;';
  // find campaigns from cache...
  client.json_get('campaigns', (err, resultOfCampaginChache) => {
    if (err) throw err;
    if (resultOfCampaginChache) {
      const resultOfCampaginChacheDecode = JSON.parse(resultOfCampaginChache);
      // 將 story 描述轉乘 utf8 ,避免中文變成亂碼
      resultOfCampaginChacheDecode.data.forEach((obj) => {
        // eslint-disable-next-line no-param-reassign
        obj.story = utf8.decode(obj.story);
      });
      // console.log('Key: campaigns found value in redis... ');
      res.send(resultOfCampaginChacheDecode);
    } else {
      // console.log('Key: campaigns cam\'t not found value in redis... ');
      db.query(queryCampaignList, (err, resultOfQueryChampaignList) => {
        if (err) throw err;
        for (let i = 0; i < resultOfQueryChampaignList.length; i += 1) {
          resultOfCampagin.push(resultOfQueryChampaignList[i]);
          if (resultOfCampagin.length === resultOfQueryChampaignList.length) {
            const inputData = JSON.stringify({ data: resultOfCampagin }); // parser to json
            // console.log('Add key = campains & value = json into cache ... ');
            client.json_set('campaigns', '.', inputData, (err) => {
              if (err) throw err;
            });
            res.set({ 'content-type': 'application/json; charset=utf-8' }).send({ data: resultOfCampagin });
          }
        }
      }); // edd of query
    } // loop for check chache key name
  }); // 判斷 reids 有無存在 key = campaigns
});
