const path = require('path');
const crypto = require('crypto');
const Model = require('./model');
const { getCatalogs } = require('./catalogs');
const logger = require('./logger');
const { startConnectionScan, getConnectionScanStatus } = require('./asset-health');

// Returns correlation metadata used by audit records.
function auditContext(req, outcome = 'success') {
    const clientHash=req.ip ? crypto.createHash('sha256').update(req.ip).digest('hex').slice(0,12) : null;
    return { requestId:req.requestId,actor:req.authenticatedUser || 'owner',outcome,metadata:{ method:req.method,path:req.path,clientHash } };
}

// Sends a consistent error response and records operational and audit context.
function sendError(req, res, error, operation, audit = {}) {
    const status = error.status || 500;
    logger.event(status >= 500 ? 'error' : 'warn', `${operation}.failed`, `${operation} failed`, {
        requestId:req.requestId,statusCode:status,errorName:error.name,errorMessage:error.message,
        stack:status >= 500 ? error.stack : undefined,entityId:audit.entityId,
    });
    try {
        Model.recordAudit(audit.action || operation, audit.entityType || 'operation', audit.entityId, {
            errorName:error.name,errorMessage:error.message,errorCode:error.code || null,statusCode:status,conflict:error.details?.conflict || null,
        }, auditContext(req, 'failure'));
    } catch (auditError) {
        logger.event('error', 'audit.write.failed', 'Failure audit entry could not be written', { requestId:req.requestId,errorMessage:auditError.message });
    }
    res.status(status).json({ message:error.message || 'Internal server error',requestId:req.requestId,
        ...(error.code ? { code:error.code } : {}),...(error.details ? error.details : {}) });
}

// Returns the compatibility movie collection used by older clients.
exports.getMovies = (req, res) => {
    try { res.json({ message:'Library loaded', movies:Model.getMovies() }); }
    catch (error) { sendError(req,res,error,'content.compatibility_read'); }
};

// Returns a paginated collection for the current application.
exports.getContent = (req, res) => {
    try { res.json(Model.getContent(req.query)); }
    catch (error) { sendError(req,res,error,'content.query'); }
};

// Returns a single movie or series by identifier.
exports.getContentById = (req, res) => {
    try {
        const item = Model.getById(req.params.id);
        if (!item) return res.status(404).json({ message:'Content item not found' });
        return res.json(item);
    } catch (error) { return sendError(req,res,error,'content.read',{ entityType:'content',entityId:req.params.id }); }
};

// Creates a movie or series from the request payload.
exports.addMovie = (req, res) => {
    try { res.status(201).json({ message:`${req.body.title} was added`,item:Model.addContent(req.body,auditContext(req)) }); }
    catch (error) { sendError(req,res,error,'content.create',{ action:'create',entityType:'content' }); }
};

// Updates a movie or series from the request payload.
exports.editMovie = (req, res) => {
    try { res.json({ message:`${req.body.title} was updated`,item:Model.updateContent(req.body,auditContext(req)) }); }
    catch (error) { sendError(req,res,error,'content.update',{ action:'update',entityType:'content',entityId:req.body.id || req.params.id }); }
};

// Moves a movie or series to recoverable trash.
exports.deleteMovie = (req, res) => {
    try {
        const item = Model.deleteContent(req.body?.movieId || req.params.id,auditContext(req));
        res.json({ message:`${item.title} was moved to trash`, item });
    } catch (error) { sendError(req,res,error,'content.trash',{ action:'trash',entityType:'content',entityId:req.body?.movieId || req.params.id }); }
};

// Restores one trashed item to the active library.
exports.restoreContent = (req, res) => {
    try {
        const result = Model.restoreContent(req.params.id,req.body?.resolution || '',auditContext(req));
        const message=result.resolution === 'merge' ? `${result.item.title} was merged with the active entry`
            : result.resolution === 'replace' ? `${result.item.title} was restored and the conflicting entry was moved to trash`
                : `${result.item.title} was restored to the library`;
        res.json({ message,item:result.item,resolution:result.resolution,backup:result.backupFile ? path.basename(result.backupFile) : undefined });
    } catch (error) { sendError(req,res,error,'content.restore',{ action:'restore',entityType:'content',entityId:req.params.id }); }
};

// Permanently deletes one trashed item after a verified recovery backup.
exports.permanentlyDeleteContent = (req, res) => {
    try {
        const result = Model.permanentlyDeleteContent(req.params.id,auditContext(req));
        res.json({ message:`${result.item.title} was permanently deleted`,backup:path.basename(result.backupFile) });
    } catch (error) { sendError(req,res,error,'content.permanent_delete',{ action:'permanent-delete',entityType:'content',entityId:req.params.id }); }
};

// Toggles the favorite state of a movie or series.
exports.toggleFavorite = (req, res) => {
    try {
        const item = Model.toggleFavorite(req.body?.movieId || req.params.id,auditContext(req));
        res.json({ message:`${item.title} favorite status was updated`, item });
    } catch (error) { sendError(req,res,error,'content.favorite',{ action:'favorite',entityType:'content',entityId:req.body?.movieId || req.params.id }); }
};

// Returns selection catalogs for countries, ratings, genres, and watch sources.
exports.getCatalogs = (_req, res) => res.json({ ...getCatalogs(),...Model.getFilterCatalogs() });

// Returns a bounded production-company autocomplete result.
exports.searchProductionCompanies=(req,res) => res.json({ items:Model.searchProductionCompanies(req.query.q) });

// Returns active asset-health notifications.
exports.getNotifications = (_req, res) => res.json({ notifications:Model.getNotifications() });

// Marks an asset-health notification as read.
exports.readNotification = (req, res) => {
    try { Model.markNotificationRead(req.params.id,auditContext(req)); res.status(204).end(); }
    catch (error) { sendError(req,res,error,'notification.read',{ action:'read',entityType:'notification',entityId:req.params.id }); }
};

// Streams a portable JSON export without retaining a server-side copy.
exports.exportData = (_req, res) => {
    try {
        const payload = Model.buildExportPayload();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="cinevault.${timestamp}.json"`);
        Model.recordAudit('export','library',null,{ format:'json',destination:'browser',contentCount:payload.content.length },auditContext(_req));
        res.send(JSON.stringify(payload, null, 2));
    } catch (error) { sendError(_req,res,error,'library.export',{ action:'export',entityType:'library' }); }
};

// Generates a verified SQLite backup and returns its filename.
exports.backupData = (_req, res) => {
    try {
        const file = Model.createBackup(auditContext(_req));
        res.json({ message:'Backup created and verified', filename:path.basename(file) });
    } catch (error) { sendError(_req,res,error,'database.backup',{ action:'backup',entityType:'database' }); }
};

// Returns a paginated diagnostic view of immutable audit events.
exports.getAudit = (req, res) => {
    try { res.json(Model.getAudit(req.query)); }
    catch (error) { sendError(req,res,error,'audit.query'); }
};

// Returns aggregated library metrics for the statistics dashboard.
exports.getStatistics = (req, res) => {
    try { res.json(Model.getStatistics()); }
    catch (error) { sendError(req,res,error,'statistics.query'); }
};

// Returns actionable library data-quality checks for the administration screen.
exports.getDataHealth = (req,res) => {
    try { res.json(Model.getDataHealth()); }
    catch(error) { sendError(req,res,error,'data_health.query'); }
};

// Applies one reviewed production-company merge after creating a recovery backup.
exports.mergeProductionCompanies = (req,res) => {
    try {
        const result=Model.mergeProductionCompanies(req.body,auditContext(req));
        res.json({ message:`${result.merged} company alias${result.merged === 1 ? '' : 'es'} merged into ${result.company.name}`,
            ...result,backup:path.basename(result.backupFile) });
    } catch(error) { sendError(req,res,error,'production_company.merge',{ action:'merge',entityType:'production-company',entityId:req.body?.keepId }); }
};

// Hides a reviewed company suggestion while retaining all company records unchanged.
exports.dismissProductionCompanySuggestion = (req,res) => {
    try { res.json(Model.dismissProductionCompanySuggestion(req.params.key,auditContext(req))); }
    catch(error) { sendError(req,res,error,'production_company.dismiss',{ action:'dismiss-merge-suggestion',entityType:'production-company' }); }
};

// Applies a reviewed canonical spelling to supported metadata values.
exports.mergeCanonicalValues = (req,res) => {
    try { const result=Model.mergeCanonicalValues(req.body,auditContext(req)); res.json({ message:`${result.updated} records updated to ${result.preferred}`,...result,backup:path.basename(result.backupFile) }); }
    catch(error) { sendError(req,res,error,'canonical_value.merge',{ action:'canonical-merge',entityType:req.body?.category || 'metadata' }); }
};

// Previews a portable JSON import and reports title conflicts without changing data.
exports.previewImport=(req,res) => { try { res.json(Model.previewImport(req.body)); } catch(error) { sendError(req,res,error,'library.import_preview'); } };

// Applies explicit per-title JSON import decisions after creating a recovery backup.
exports.applyImport=(req,res) => { try { res.json(Model.applyImport(req.body.payload,req.body.decisions,auditContext(req))); } catch(error) { sendError(req,res,error,'library.import',{ action:'import',entityType:'library' }); } };

// Applies a reviewed lifecycle value to selected active library entries.
exports.bulkUpdateContent=(req,res) => { try { res.json(Model.bulkUpdateContent(req.body,auditContext(req))); } catch(error) { sendError(req,res,error,'content.bulk_update',{ action:'bulk-update',entityType:'content' }); } };

// Starts a full asset-health scan for a newly connected frontend client.
exports.connectClient = (req, res) => {
    const scan=startConnectionScan(req.body?.force === true);
    res.status(scan.status === 'running' ? 202 : 200).json({ id:scan.id,status:scan.status });
};

// Returns progress for the active client-triggered asset-health scan.
exports.getAssetScanStatus = (_req, res) => res.json(getConnectionScanStatus());
