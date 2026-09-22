const express = require('express');
const controller = require('./controller');

const router = express.Router();

router.get('/movie', controller.getMovies);
router.post('/movie', controller.addMovie);
router.put('/movie', controller.editMovie);
router.delete('/movie', controller.deleteMovie);
router.patch('/movie', controller.toggleFavorite);

router.get('/v1/content', controller.getContent);
router.get('/v1/content/:id', controller.getContentById);
router.post('/v1/content', controller.addMovie);
router.put('/v1/content/:id', controller.editMovie);
router.patch('/v1/content/bulk/lifecycle',controller.bulkUpdateContent);
router.delete('/v1/content/:id', controller.deleteMovie);
router.patch('/v1/content/:id/favorite', controller.toggleFavorite);
router.post('/v1/trash/:id/restore', controller.restoreContent);
router.delete('/v1/trash/:id/permanent', controller.permanentlyDeleteContent);
router.get('/v1/catalogs', controller.getCatalogs);
router.get('/v1/catalogs/production-companies',controller.searchProductionCompanies);
router.get('/v1/notifications', controller.getNotifications);
router.patch('/v1/notifications/:id/read', controller.readNotification);
router.get('/v1/export/json', controller.exportData);
router.post('/v1/export/json', controller.exportView);
router.post('/v1/backup', controller.backupData);
router.get('/v1/audit', controller.getAudit);
router.get('/v1/statistics', controller.getStatistics);
router.get('/v1/data-health', controller.getDataHealth);
router.post('/v1/data-health/production-companies/merge',controller.mergeProductionCompanies);
router.post('/v1/data-health/production-companies/:key/dismiss',controller.dismissProductionCompanySuggestion);
router.post('/v1/data-health/canonical-values/merge',controller.mergeCanonicalValues);
router.post('/v1/import/preview',controller.previewImport);
router.post('/v1/import/apply',controller.applyImport);
router.post('/v1/session/connect', controller.connectClient);
router.get('/v1/asset-scan', controller.getAssetScanStatus);

module.exports = router;
