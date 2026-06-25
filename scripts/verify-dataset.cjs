const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'data');
const expectedMinimum = {
  baguette: 15,
  bread: 15,
  campagne: 14,
  danish: 15,
  roll: 15,
  twist: 15,
};

function imageCount(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory).filter((file) => /\.(jpe?g|png)$/i.test(file)).length;
}

let valid = true;
const trainingRoot = path.join(root, 'training');
const actualClasses = fs.existsSync(trainingRoot)
  ? fs.readdirSync(trainingRoot).filter((entry) => fs.statSync(path.join(trainingRoot, entry)).isDirectory())
  : [];

for (const label of Object.keys(expectedMinimum)) {
  if (!actualClasses.includes(label)) {
    console.error(`${label} フォルダがありません。`);
    valid = false;
  }
}

for (const [label, minimum] of Object.entries(expectedMinimum)) {
  const count = imageCount(path.join(root, 'training', label));
  console.log(`${label}: ${count} 枚`);
  if (count < minimum) {
    console.error(`${label} は ${minimum} 枚必要です。`);
    valid = false;
  }
}

const mixedCount = imageCount(path.join(root, 'evaluation', 'mixed'));
console.log(`mixed evaluation: ${mixedCount} 枚`);
if (mixedCount !== 6) {
  console.error('評価用の複数パン画像は 6 枚である必要があります。');
  valid = false;
}

if (!valid) process.exitCode = 1;
