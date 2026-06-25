const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createStore } = require('../electron/database.cjs');

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bread-test-'));
  const store = createStore(path.join(directory, 'register.sqlite'));
  try {
    callback(store);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('seeds the six products from the lecture price list', () => {
  withStore((store) => {
    const products = store.listProducts();
    assert.equal(products.length, 6);
    assert.deepEqual({ ...products.find((product) => product.id === 'campagne') }, {
      id: 'campagne',
      name: 'カンパーニュ',
      priceYen: 420,
    });
  });
});

test('calculates totals from database prices and combines duplicate cart lines', () => {
  withStore((store) => {
    const receipt = store.checkout([
      { productId: 'roll', quantity: 2 },
      { productId: 'campagne', quantity: 1 },
      { productId: 'roll', quantity: 1 },
    ]);
    assert.equal(receipt.totalYen, 780);
    assert.equal(receipt.items.length, 2);
    assert.deepEqual(receipt.items.find((item) => item.productId === 'roll'), {
      productId: 'roll',
      name: 'ロール',
      unitPriceYen: 120,
      quantity: 3,
      subtotalYen: 360,
    });
  });
});

test('rejects unknown products and invalid quantities', () => {
  withStore((store) => {
    assert.throws(
      () => store.checkout([{ productId: 'unknown', quantity: 1 }]),
      /存在しない商品/,
    );
    assert.throws(
      () => store.checkout([{ productId: 'roll', quantity: 0 }]),
      /数量は 1 から 99/,
    );
  });
});
