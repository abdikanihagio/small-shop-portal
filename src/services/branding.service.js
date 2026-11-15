// The shop's logo (sign-in page, sidebar, receipts) and icon (browser tab).
const BrandingModel = require('../models/branding.model');
const audit = require('./audit.service');
const { transaction } = require('../config/database');
const { notFound } = require('../utils/http-error');

const LABEL = { logo: 'Logo', icon: 'Icon' };

const status = () => BrandingModel.versions();

async function image(kind) {
  const row = await BrandingModel.find(kind);
  if (!row) throw notFound(`No ${kind} uploaded`);
  return row;
}

const save = (actor, kind, { mime, data }) =>
  transaction(async () => {
    await BrandingModel.save(kind, mime, data);
    await audit.record(actor, 'branding.updated', 'branding', kind, { image: LABEL[kind], type: mime, size: `${Math.ceil(data.length / 1024)} KB` });
    return status();
  });

const remove = (actor, kind) =>
  transaction(async () => {
    if (await BrandingModel.remove(kind)) await audit.record(actor, 'branding.removed', 'branding', kind, { image: LABEL[kind] });
    return status();
  });

module.exports = { status, image, save, remove };
