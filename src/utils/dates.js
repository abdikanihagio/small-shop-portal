// Dates in the shop's local time, as YYYY-MM-DD.
const pad = (n) => String(n).padStart(2, '0');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const monthStart = () => today().slice(0, 8) + '01';

function nowStamp() {
  const d = new Date();
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { today, monthStart, nowStamp };
