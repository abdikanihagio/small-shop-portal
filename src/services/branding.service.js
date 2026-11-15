// The shop's logo (sign-in page, sidebar, receipts) and icon (browser tab).
const BrandingModel = require('../models/branding.model');
const audit = require('./audit.service');
const { notFound } = require('../utils/http-error');

const LABEL = { logo: 'Logo', icon: 'Icon' };

const status = () => BrandingModel.versions();

function image(kind) {
  const row = BrandingModel.find(kind);
  if (!row) throw notFound(`No ${kind} uploaded`);
  return row;
}

function save(actor, kind, { mime, data }) {
  BrandingModel.save(kind, mime, data);
  audit.record(actor, 'branding.updated', 'branding', kind, { image: LABEL[kind], type: mime, size: `${Math.ceil(data.length / 1024)} KB` });
  return status();
}

function remove(actor, kind) {
  if (BrandingModel.remove(kind)) audit.record(actor, 'branding.removed', 'branding', kind, { image: LABEL[kind] });
  return status();
}

module.exports = { status, image, save, remove };
