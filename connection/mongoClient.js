// connection/mongoClient.js
const { MongoClient } = require('mongodb');

const mongoUrl = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/products';

// 你可以調整 maxPoolSize（同時連線數）
// serverSelectionTimeoutMS 避免卡太久
const client = new MongoClient(mongoUrl, {
  maxPoolSize: 20,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5000,
});

let clientPromise = null;

async function getMongoClient() {
  if (!clientPromise) clientPromise = client.connect();
  return clientPromise;
}

async function getMongoDb(dbName = 'products') {
  const c = await getMongoClient();
  return c.db(dbName);
}

async function closeMongo() {
  if (clientPromise) {
    const c = await clientPromise;
    await c.close();
    clientPromise = null;
  }
}

module.exports = { getMongoDb, getMongoClient, closeMongo };
