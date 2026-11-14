const { MAX_PASSWORD } = require('../config/constants');
const { bad } = require('../utils/http-error');

// Passwords people (and password-guessing tools) try first. Only 8+ character ones matter,
// because shorter passwords are already refused.
const COMMON_PASSWORDS = new Set(
  `password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword password! mypassword
  12345678 123456789 1234567890 0123456789 87654321 987654321 9876543210 11111111 00000000 22222222 55555555
  66666666 88888888 99999999 12121212 11223344 12341234 123123123 147258369 159753456 1q2w3e4r 1qaz2wsx q1w2e3r4
  qwerty12 qwerty123 qwertyuiop qwertyui asdfghjk asdf1234 zxcvbnm1 zxcvbnm123 abcd1234 abc12345 abcdefgh
  iloveyou iloveyou1 sunshine princess football baseball superman starwars trustno1 whatever computer internet
  welcome1 welcome123 letmein1 letmein123 changeme changeme1 secret123 master123 monkey123 dragon123
  admin123 admin1234 administrator adminadmin test1234 testtest shop1234 shop12345 myshop123 cashier1 cashier123
  owner123 owner1234 business1 money123 qazwsxedc 1234qwer qwer1234`.split(/\s+/)
);

// A new password must be 8–256 characters and not common, repetitive, or built from the
// username or shop name.
function checkNewPassword(pw, { username = '', shopName = '' } = {}) {
  pw = String(pw ?? '');
  if (pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > MAX_PASSWORD) throw bad(`Password must be at most ${MAX_PASSWORD} characters`);
  const lower = pw.toLowerCase();
  const user = String(username).trim().toLowerCase();
  const shop = String(shopName || '').trim().toLowerCase().replace(/\s+/g, '');
  const tooEasy =
    COMMON_PASSWORDS.has(lower) ||
    /^(.)\1+$/.test(pw) ||
    (user.length >= 3 && lower.includes(user)) ||
    (shop.length >= 3 && lower.replace(/\s+/g, '').includes(shop));
  if (tooEasy) throw bad('This password is too easy to guess. Try a longer phrase, for example three unrelated words.');
  return pw;
}

module.exports = { checkNewPassword };
