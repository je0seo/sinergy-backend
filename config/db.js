const fs = require("fs");
const path = require('path');
const { Client } = require('pg');

// 'DigiCertGlobalRootCA.crt.pem' 파일의 경로
const filePath = '/Users/je_0seo/Desktop/gp4react/public/DigiCertGlobalRootCA.crt.pem';

let fileContents;

try {
  fileContents = fs.readFileSync(filePath, 'utf8');
  //console.log(fileContents);
} catch (error) {
  console.error('파일을 읽는 동안 오류 발생:', error.message);
}

const client = new Client({
    host: "je0seo.postgres.database.azure.com",
    user: "je0seo",
    password: "Dlwngml823",
    database: "postgres",
    port: 5432,
    ssl: { ca: fileContents },
    max: 5
});

module.exports = client;
