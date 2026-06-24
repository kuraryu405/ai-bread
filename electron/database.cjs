const { DatabaseSync } = require('node:sqlite');

const PRODUCTS = [
  { id: 'bread', name: 'ブレッド', priceYen: 280 },
  { id: 'twist', name: 'ツイスト', priceYen: 160 },
  { id: 'danish', name: 'デニッシュ', priceYen: 220 },
  { id: 'roll', name: 'ロール', priceYen: 120 },
  { id: 'baguette', name: 'バゲット', priceYen: 350 },
  { id: 'campagne', name: 'カンパーニュ', priceYen: 420 },
];

function assertCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('カートが空です。');
  }

  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.productId !== 'string' || !Number.isInteger(item.quantity)) {
      throw new Error('カートの形式が正しくありません。');
    }
    if (item.quantity < 1 || item.quantity > 99) {
      throw new Error('数量は 1 から 99 の範囲で指定してください。');
    }
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }

  return quantities;
}

function createStore(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_yen INTEGER NOT NULL CHECK (price_yen >= 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      total_yen INTEGER NOT NULL CHECK (total_yen >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit_price_yen INTEGER NOT NULL CHECK (unit_price_yen >= 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      subtotal_yen INTEGER NOT NULL CHECK (subtotal_yen >= 0)
    ) STRICT;
  `);

  const insertProduct = db.prepare(
    'INSERT OR IGNORE INTO products (id, name, price_yen) VALUES (?, ?, ?)',
  );
  for (const product of PRODUCTS) {
    insertProduct.run(product.id, product.name, product.priceYen);
  }

  const listProductsStatement = db.prepare(
    'SELECT id, name, price_yen AS priceYen FROM products ORDER BY rowid',
  );
  const getProductStatement = db.prepare(
    'SELECT id, name, price_yen AS priceYen FROM products WHERE id = ?',
  );
  const insertSaleStatement = db.prepare('INSERT INTO sales (total_yen) VALUES (?)');
  const insertSaleItemStatement = db.prepare(`
    INSERT INTO sale_items (sale_id, product_id, product_name, unit_price_yen, quantity, subtotal_yen)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  return {
    listProducts() {
      return listProductsStatement.all();
    },

    checkout(items) {
      const quantities = assertCartItems(items);
      const receiptItems = [];

      for (const [productId, quantity] of quantities) {
        const product = getProductStatement.get(productId);
        if (!product) {
          throw new Error(`存在しない商品です: ${productId}`);
        }
        receiptItems.push({
          productId: product.id,
          name: product.name,
          unitPriceYen: product.priceYen,
          quantity,
          subtotalYen: product.priceYen * quantity,
        });
      }

      const totalYen = receiptItems.reduce((sum, item) => sum + item.subtotalYen, 0);
      db.exec('BEGIN IMMEDIATE');
      try {
        const sale = insertSaleStatement.run(totalYen);
        const saleId = Number(sale.lastInsertRowid);
        for (const item of receiptItems) {
          insertSaleItemStatement.run(
            saleId,
            item.productId,
            item.name,
            item.unitPriceYen,
            item.quantity,
            item.subtotalYen,
          );
        }
        db.exec('COMMIT');
        return { saleId, totalYen, items: receiptItems };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    close() {
      db.close();
    },
  };
}

module.exports = { PRODUCTS, createStore };
