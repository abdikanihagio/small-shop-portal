// The shop's look: logo (sign-in page, sidebar, receipts), icon (browser tab) and colours.
// All of it is public, because the sign-in page shows it before anyone signs in.
const BrandingModel = require('../models/branding.model');
const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const { transaction } = require('../config/database');
const { notFound } = require('../utils/http-error');

const LABEL = { logo: 'Logo', icon: 'Icon' };

async function status() {
  const [versions, settings] = await Promise.all([BrandingModel.versions(), SettingsModel.all()]);
  return { ...versions, colors: { primary: settings.primary_color || '', sidebar: settings.sidebar_color || '' } };
}

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
