// Customers, suppliers and the payments recorded against their accounts.
const { str, money, positiveMoney } = require('./common.validator');

function readCustomer(body) {
  return {
    name: str(body.name, 'Name', { required: true, max: 120 }),
    phone: str(body.phone, 'Phone', { max: 40 }),
    email: str(body.email, 'Email', { max: 120 }),
    address: str(body.address, 'Address', { max: 300 }),
    id_number: str(body.id_number, 'ID number', { max: 60 }),
    credit_limit_cents: money(body.credit_limit ?? 0, 'Credit limit'),
    notes: str(body.notes, 'Notes', { max: 1000 }),
  };
}

function readSupplier(body) {
  return {
    name: str(body.name, 'Name', { required: true, max: 120 }),
    contact_person: str(body.contact_person, 'Contact person', { max: 120 }),
    phone: str(body.phone, 'Phone', { max: 40 }),
    email: str(body.email, 'Email', { max: 120 }),
    address: str(body.address, 'Address', { max: 300 }),
    tax_id: str(body.tax_id, 'Tax ID', { max: 60 }),
    notes: str(body.notes, 'Notes', { max: 1000 }),
  };
}

const readActive = (body) => (body.active === false ? 0 : 1);

function readPayment(body) {
  return {
    amount: positiveMoney(body.amount),
    method: str(body.method, 'Payment method', { max: 20 }) || 'cash',
    note: str(body.note, 'Note'),
  };
}

module.exports = { readCustomer, readSupplier, readActive, readPayment };
