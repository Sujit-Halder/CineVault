import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { FaDatabase, FaDownload, FaFilter, FaPlus,FaList,FaThLarge,FaTable } from 'react-icons/fa';
import MovieCard from './MovieCard';
import MovieForm from './MovieForm';
import NotificationPanel from './NotificationPanel';
import FilterPanel from './FilterPanel';
import Statistics from './Statistics';
import DataHealth from './DataHealth';
import LibraryTable from './LibraryTable';
import ActivityLog from './ActivityLog';
import AccountManagement from './AccountManagement';
import { AWARDS, PERSONAL_RATINGS, TAGS } from '../catalogOptions';

const API = import.meta.env.VITE_API_URL;

// Manages server-backed library queries, editing, pagination, exports, and notifications.
const Content = ({ selectedMenu, searchTerm, focusRequest, onNavigate, onNotificationsChanged, onTrashChanged, onLibraryChanged, onLoadingChange, user }) => {
  const [result, setResult] = useState({ items:[], total:0, page:1, pages:0 });
  const [catalogs, setCatalogs] = useState({ countries:[],languages:[], ratingSystems:[], genres:[],presentationForms:{ movie:[],series:[] },watchSources:[],subtypes:{ movie:[],series:[] },productionCompanies:[],linkDomains:[] });
  const [notifications, setNotifications] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [sort, setSort] = useState('modification');
  const [order, setOrder] = useState('descending');
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [restoreConflict,setRestoreConflict] = useState(null);
  const [selectedRows,setSelectedRows]=useState([]);
  const [showExport,setShowExport]=useState(false);
  const [exportFormat,setExportFormat]=useState('complete');
  const [exporting,setExporting]=useState(false);
  const [viewMode,setViewMode]=useState(() => localStorage.getItem('cinevault-view') || 'cards');
  const [focusId,setFocusId] = useState(null);
  const [focusReturnMenu,setFocusReturnMenu]=useState('Library');
  const [filters, setFilters] = useState({ type:'',subtype:'',productionStatus:'',releaseStatus:'',viewingStatus:'',genres:[],presentationForms:[],languages:[],tags:[],rating:'',awards:[],countries:[],releaseYear:'',productionCompanies:[],watchSources:[],linkDomains:[] });
  const contentTopRef = useRef(null);
  const previousPageRef = useRef(page);
  const requestSequenceRef = useRef(0);
  const activeFilterCount = Object.values(filters).reduce((count, value) => count + (Array.isArray(value) ? (value.length ? 1 : 0) : (value ? 1 : 0)), 0);
  const exportUnavailable=!focusId && selectedRows.length === 0 && result.total === 0;

  // Builds the canonical query shared by pagination and view-scoped exports.
  const buildViewQuery = (includePage=true) => {
    const params={ search:searchTerm,sort,order };
    if (includePage) { params.page=page; params.limit=20; }
    if (selectedMenu === 'Movies') { params.type='movie'; params.viewingStatus='Watched'; }
    if (selectedMenu === 'Series') params.type='series';
    if (selectedMenu === 'Favorites') params.favorite=true;
    if (selectedMenu === 'Watch Later') params.watchLater=true;
    if (selectedMenu === 'Trash') params.trashed=true;
    Object.entries(filters).forEach(([key,value]) => {
      if (selectedMenu === 'Movies' && (key === 'viewingStatus' || key === 'type')) return;
      if (selectedMenu === 'Series' && key === 'type') return;
      if ((selectedMenu === 'Movies' || selectedMenu === 'Series') && key === 'subtype') {
        const lockedType=selectedMenu === 'Movies' ? 'movie' : 'series';
        if (!(catalogs.subtypes?.[lockedType] || []).includes(value)) return;
      }
      if (Array.isArray(value) && value.length) params[key]=value.join(',');
      else if (!Array.isArray(value) && value) params[key]=value;
    });
    return params;
  };

  // Removes the one-use editor deep link while preserving unrelated query parameters and the current hash.
  const clearEditQuery = () => {
    const url=new URL(window.location.href);
    if (!url.searchParams.has('edit')) return;
    url.searchParams.delete('edit');
    window.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
  };

  // Displays a temporary status message.
  const notify = (text) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3500);
  };

  // Loads the paginated library using the current navigation and query state.
  const loadContent = async () => {
    const requestSequence=++requestSequenceRef.current;
    if (selectedMenu === 'Notifications' || selectedMenu === 'Statistics' || selectedMenu === 'Data Health' || selectedMenu === 'Activity' || selectedMenu === 'Accounts') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (selectedMenu === 'Library' && focusId) {
        const response=await axios.get(`${API}/api/v1/content/${focusId}`);
        if (requestSequence === requestSequenceRef.current) setResult({ items:[response.data],total:1,page:1,pages:1 });
        return;
      }
      const params=buildViewQuery();
      const response = await axios.get(`${API}/api/v1/content`, { params });
      if (requestSequence === requestSequenceRef.current) setResult(response.data);
    } catch (error) {
      if (requestSequence === requestSequenceRef.current) notify(error.response?.data?.message || 'The library could not be loaded');
    }
    finally { if (requestSequence === requestSequenceRef.current) setLoading(false); }
  };

  // Loads metadata catalogs and active asset notifications.
  const loadSupportData = async () => {
    try {
      const [catalogResponse, notificationResponse] = await Promise.all([
        axios.get(`${API}/api/v1/catalogs`), axios.get(`${API}/api/v1/notifications`),
      ]);
      setCatalogs(catalogResponse.data);
      setNotifications(notificationResponse.data.notifications);
    } catch { notify('Selection catalogs could not be loaded'); }
  };

  // Catalogs are static for the lifetime of the page and load once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSupportData(); }, []);
  useEffect(() => {
    if (selectedMenu === 'Notifications') loadSupportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMenu]);
  useEffect(() => { setPage(1); }, [selectedMenu, searchTerm, sort, order, filters]);
  useEffect(() => { setSelectedRows([]); },[selectedMenu,searchTerm,sort,order,filters]);
  // Library results reload whenever their query inputs change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadContent(); }, [selectedMenu, searchTerm, sort, order, page, filters, focusId]);

  // Opens a title requested by another application surface as a focused library entry.
  useEffect(() => {
    if (!focusRequest?.id) return;
    setFocusReturnMenu('Library');
    setFocusId(focusRequest.id);
    setPage(1);
    window.scrollTo({ top:0,behavior:'smooth' });
  },[focusRequest]);
  useEffect(() => { onLoadingChange?.(loading); },[loading,onLoadingChange]);

  useEffect(() => {
    setPageInput(String(page));
    if (previousPageRef.current !== page) {
      contentTopRef.current?.scrollIntoView({ behavior:'smooth', block:'start' });
      previousPageRef.current = page;
    }
  }, [page]);

  // Persists a new or existing content item and refreshes the current page.
  const saveItem = async (item) => {
    try {
      const response = item.id
        ? await axios.put(`${API}/api/v1/content/${item.id}`, item)
        : await axios.post(`${API}/api/v1/content`, item);
      notify(response.data.message);
      setShowForm(false); setEditing(null);
      clearEditQuery();
      await Promise.all([loadContent(), loadSupportData()]);
      onNotificationsChanged(); onLibraryChanged();
    } catch (error) { notify(error.response?.data?.message || 'The entry could not be saved'); }
  };

  // Opens an existing item in the editor without leaving a reload-persistent URL state.
  const editItem = async (itemOrId) => {
    try {
      const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
      const response = await axios.get(`${API}/api/v1/content/${id}`);
      setEditing(response.data); setShowForm(true);
    } catch { notify('The selected entry could not be opened'); }
  };

  // Closes the editor and clears its deep link.
  const closeEditor = () => {
    setShowForm(false); setEditing(null);
    clearEditQuery();
  };

  // Moves an item to trash after explicit confirmation.
  const deleteItem = async (item) => {
    if (!window.confirm(`Move “${item.title}” to trash?`)) return;
    try {
      const response = await axios.delete(`${API}/api/v1/content/${item.id}`);
      notify(response.data.message); onTrashChanged(); onLibraryChanged(); loadContent();
    } catch (error) { notify(error.response?.data?.message || 'The entry could not be moved to trash'); }
  };

  // Toggles a favorite without replacing the current result collection.
  const toggleFavorite = async (item) => {
    try { await axios.patch(`${API}/api/v1/content/${item.id}/favorite`); loadContent(); }
    catch { notify('Favorite status could not be updated'); }
  };

  // Restores a trashed entry to the active library.
  const restoreItem = async (item) => {
    try {
      const response = await axios.post(`${API}/api/v1/trash/${item.id}/restore`);
      notify(response.data.message);
      onTrashChanged();
      onLibraryChanged();
      if (result.items.length === 1 && page > 1) setPage((value) => value - 1); else loadContent();
    } catch (error) {
      if (error.response?.data?.code === 'RESTORE_CONFLICT') {
        setRestoreConflict({ item,conflict:error.response.data.conflict });
        return;
      }
      notify(error.response?.data?.message || 'The entry could not be restored');
    }
  };

  // Applies the selected resolution to a restore identity conflict.
  const resolveRestoreConflict = async (resolution) => {
    if (!restoreConflict) return;
    if (resolution === 'replace' && !window.confirm(`Replace “${restoreConflict.conflict.title}”? The active entry will be moved to Trash.`)) return;
    try {
      const response=await axios.post(`${API}/api/v1/trash/${restoreConflict.item.id}/restore`,{ resolution });
      notify(response.data.message); setRestoreConflict(null); onTrashChanged(); onLibraryChanged(); loadContent();
    } catch (error) { notify(error.response?.data?.message || 'The restore conflict could not be resolved'); }
  };

  // Permanently deletes a trashed entry after exact-title confirmation.
  const permanentlyDeleteItem = async (item) => {
    const confirmation = window.prompt(`Permanent deletion cannot be undone from Trash. A recovery backup will be created first.\n\nType the exact title to delete:\n${item.title}`);
    if (confirmation !== item.title) {
      if (confirmation !== null) notify('The title did not match. Nothing was deleted.');
      return;
    }
    try {
      const response = await axios.delete(`${API}/api/v1/trash/${item.id}/permanent`);
      notify(`${response.data.message}. Recovery backup: ${response.data.backup}`);
      onTrashChanged();
      onLibraryChanged();
      if (result.items.length === 1 && page > 1) setPage((value) => value - 1); else loadContent();
    } catch (error) { notify(error.response?.data?.message || 'The entry could not be permanently deleted'); }
  };

  // Opens the notified entry and marks its notification as read.
  const openNotification = async (notification) => {
    await axios.patch(`${API}/api/v1/notifications/${notification.id}/read`);
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read:true } : item));
    onNotificationsChanged();
    setFocusId(notification.contentId);
    setFocusReturnMenu('Library');
    onNavigate('Library');
  };

  // Downloads the selected rows or complete filtered view in the chosen portable format.
  const exportData = async () => {
    if (exporting) return;
    const selected=focusId ? [focusId] : viewMode === 'table' ? selectedRows.map((item) => item.id) : [];
    setExporting(true); setMessage('Preparing your export…');
    try {
      const response=await axios.post(`${API}/api/v1/export/json`,{
        format:exportFormat,scope:focusId ? 'Focused entry' : selected.length ? `${selectedMenu} selection` : selectedMenu,ids:selected,query:selected.length ? {} : buildViewQuery(false),
      },{ responseType:'blob' });
      const disposition=response.headers['content-disposition'] || '';
      const filename=disposition.match(/filename="([^"]+)"/)?.[1] || `cinevault.${exportFormat}.json`;
      const url=URL.createObjectURL(response.data); const link=document.createElement('a'); link.href=url; link.download=filename;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      setShowExport(false); notify(`${exportFormat === 'clean' ? 'Clean' : 'Complete'} export downloaded`);
    } catch(error) { notify(error.response?.data?.message || 'The export could not be created'); }
    finally { setExporting(false); }
  };

  // Requests a verified SQLite backup from the API.
  const backupData = async () => {
    try { const response = await axios.post(`${API}/api/v1/backup`); notify(`${response.data.message}: ${response.data.filename}`); }
    catch { notify('The database backup could not be created'); }
  };

  // Navigates directly to a validated page number.
  const goToPage = (event) => {
    event.preventDefault();
    const requested = Number.parseInt(pageInput, 10);
    const destination = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), Math.max(result.pages, 1));
    setPageInput(String(destination));
    setPage(destination);
    if (destination === page) contentTopRef.current?.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  // Persists the preferred spacious or compact library presentation.
  const changeView=(mode) => { setViewMode(mode); localStorage.setItem('cinevault-view',mode); };

  // Applies one lifecycle value to selected rows after an explicit bulk-change review.
  const bulkUpdate=async (ids,field,value) => {
    if (!window.confirm(`Apply ${value} as ${field === 'productionStatus' ? 'production' : 'release'} status to ${ids.length} selected title${ids.length === 1 ? '' : 's'}?`)) return false;
    try { const response=await axios.patch(`${API}/api/v1/content/bulk/lifecycle`,{ ids,field,value }); notify(`${response.data.updated} titles updated`); await loadContent(); onLibraryChanged(); return true; }
    catch(error) { notify(error.response?.data?.message || 'The selected titles could not be updated'); return false; }
  };

  // A shared edit link opens its content entry once on mount.
  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get('edit');
    if (requestedId) { clearEditQuery(); editItem(requestedId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (selectedMenu === 'Notifications') return <NotificationPanel notifications={notifications} onOpen={openNotification} onClose={() => onNavigate('Library')} />;
  if (selectedMenu === 'Statistics') return <Statistics />;
  if (selectedMenu === 'Data Health') return <DataHealth onLibraryChanged={onLibraryChanged} onOpen={(id) => { setFocusReturnMenu('Data Health'); setFocusId(id); onNavigate('Library'); }} />;
  if (selectedMenu === 'Activity') return <div className="content-area"><ActivityLog onOpen={(id) => { setFocusReturnMenu('Activity'); setFocusId(id); onNavigate('Library'); }} onClose={() => onNavigate('Library')} /></div>;
  if (selectedMenu === 'Accounts') return user?.role === 'owner' ? <AccountManagement onClose={() => onNavigate('Library')} /> : <div className="empty-state">Only the CineVault owner can manage accounts.</div>;

  return (
    <section className={`content-area ${loading ? 'library-is-loading' : ''}`} ref={contentTopRef} aria-busy={loading}>
      {message && <div className="toast" role="status">{message}</div>}
      <div className="library-toolbar">
        <div className="library-heading"><span className="eyebrow">{focusId ? 'FOCUSED ENTRY' : selectedMenu.toUpperCase()}</span><h2>{focusId ? 'Review this title' : loading ? 'Loading titles…' : `${result.total.toLocaleString()} titles`}</h2></div>
        <div className="toolbar-actions">
          {focusId && <button className="secondary-action" onClick={() => { const destination=focusReturnMenu; setFocusId(null); onNavigate(destination); }}>Return to {focusReturnMenu.toLowerCase()}</button>}
          <button disabled={loading} className={`secondary-action filter-trigger ${activeFilterCount ? 'has-filters' : ''}`} onClick={() => setShowFilters(true)} aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Filters'} title={activeFilterCount ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : 'Open filters'}><FaFilter /> <span className="action-label">Filters</span>{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}</button>
          <button disabled={loading} className="secondary-action" title="Cycle between cards, compact cards, and an audit table" onClick={() => changeView(viewMode === 'cards' ? 'compact' : viewMode === 'compact' ? 'table' : 'cards')} aria-label={`Use ${viewMode === 'cards' ? 'compact' : viewMode === 'compact' ? 'table' : 'card'} view`}>{viewMode === 'cards' ? <FaList /> : viewMode === 'compact' ? <FaTable /> : <FaThLarge />} <span className="action-label">{viewMode === 'cards' ? 'Compact' : viewMode === 'compact' ? 'Table' : 'Cards'}</span></button>
          <select disabled={loading} aria-label="Sort library" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="modification">Recently updated</option><option value="title">Title</option>
            <option value="creation">Creation date</option><option value="watchDate">Watch date and time</option>
            <option value="releaseDate">Release date</option><option value="duration">Runtime</option>
          </select>
          <select disabled={loading} aria-label="Sort direction" value={order} onChange={(event) => setOrder(event.target.value)}>
            <option value="descending">Descending</option><option value="ascending">Ascending</option>
          </select>
          <span title={exportUnavailable ? 'Nothing can be exported because this view contains no titles' : 'Export the selected rows or every title in this filtered and sorted view'}><button className="secondary-action" disabled={loading || exportUnavailable} onClick={() => setShowExport(true)}><FaDownload /> <span className="action-label">Export{viewMode === 'table' && selectedRows.length ? ` (${selectedRows.length})` : ''}</span></button></span>
          <button disabled={loading} className="secondary-action" title="Create and verify a complete SQLite recovery backup in the configured export location" onClick={backupData}><FaDatabase /> <span className="action-label">Backup</span></button>
          {selectedMenu !== 'Trash' && <button disabled={loading} className="primary-action mobile-add-action" aria-label="Add a title" title="Add a title" onClick={() => { setEditing(null); setShowForm(true); }}><FaPlus /> <span className="action-label">Add title</span></button>}
        </div>
      </div>
      {loading ? <div className="library-loading" role="status"><span className="loading-reel" aria-hidden="true"/><strong>Loading {selectedMenu.toLowerCase()}</strong><small>Preparing the latest titles and totals…</small><div className="loading-lines" aria-hidden="true"><i/><i/><i/></div></div> : result.items.length === 0 ? <div className="empty-state">No titles match this view.</div> : (
        viewMode === 'table' ? <LibraryTable items={result.items} selected={selectedRows} onSelectionChange={setSelectedRows} onEdit={editItem} onBulkUpdate={bulkUpdate} allowEditing={selectedMenu !== 'Trash'} /> : <div className={`card-grid ${viewMode === 'compact' ? 'compact-grid' : ''}`}>{result.items.map((item) => <MovieCard key={item.id} movieData={item} catalogs={catalogs} trashed={selectedMenu === 'Trash'} onEdit={() => editItem(item)} onDelete={() => deleteItem(item)} onToggleFavorite={() => toggleFavorite(item)} onRestore={() => restoreItem(item)} onPermanentDelete={() => permanentlyDeleteItem(item)} />)}</div>
      )}
      {!loading && result.pages > 1 && <div className="pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {result.pages}</span><form className="page-jump" onSubmit={goToPage}><label htmlFor="page-number">Go to</label><input id="page-number" type="number" min="1" max={result.pages} value={pageInput} onChange={(event) => setPageInput(event.target.value)} /><button type="submit">Go</button></form><button disabled={page === result.pages} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
      {showForm && <MovieForm initialData={editing} catalogs={catalogs} onClose={closeEditor} onSubmit={saveItem} />}
      {restoreConflict && <div className="modal-backdrop" role="presentation"><section className="conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-conflict-title"><span className="eyebrow">RESTORE CONFLICT</span><h2 id="restore-conflict-title">An active entry already matches</h2><p><strong>{restoreConflict.conflict.title}</strong> has the same type and release date as the trashed entry.</p><dl><div><dt>Cancel</dt><dd>Keep both entries unchanged.</dd></div><div><dt>Replace</dt><dd>Restore this entry and move the currently active one to Trash.</dd></div><div><dt>Merge</dt><dd>Combine metadata, watch history, and content links into the active entry.</dd></div></dl><div className="modal-actions"><button type="button" onClick={() => setRestoreConflict(null)}>Cancel</button><button type="button" onClick={() => resolveRestoreConflict('replace')}>Replace</button><button type="button" className="primary-action" onClick={() => resolveRestoreConflict('merge')}>Merge</button></div></section></div>}
      {showExport && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => !exporting && event.target === event.currentTarget && setShowExport(false)}><section className="conflict-dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title"><span className="eyebrow">PORTABLE DATA</span><h2 id="export-title">Choose export format</h2><p>{focusId ? 'The currently focused title will be exported.' : viewMode === 'table' && selectedRows.length ? `${selectedRows.length} selected title${selectedRows.length === 1 ? '' : 's'} across table pages will be exported.` : `All ${result.total.toLocaleString()} titles matching the current ${selectedMenu.toLowerCase()} view, search, filters, and sorting will be exported.`} Titles exported from Trash are restored to the active library when imported.</p><label className="export-choice"><input disabled={exporting} type="radio" name="export-format" value="complete" checked={exportFormat === 'complete'} onChange={() => setExportFormat('complete')} /><span><strong>Complete recovery export</strong><small>Retains internal IDs, timestamps, relationships, and every title detail for the closest possible reconstruction.</small></span></label><label className="export-choice"><input disabled={exporting} type="radio" name="export-format" value="clean" checked={exportFormat === 'clean'} onChange={() => setExportFormat('clean')} /><span><strong>Clean transferable export</strong><small>Retains every movie, series, season, episode, source, link, and watch record while omitting database IDs and internal timestamps.</small></span></label><div className="modal-actions"><button type="button" disabled={exporting} onClick={() => setShowExport(false)}>Cancel</button><button type="button" className="primary-action" aria-busy={exporting} disabled={exportUnavailable || exporting} onClick={exportData}><FaDownload /> {exporting ? 'Preparing export…' : 'Download export'}</button></div></section></div>}
      {showFilters && <FilterPanel filters={filters} catalogs={catalogs} awards={AWARDS} tags={TAGS} ratings={PERSONAL_RATINGS} lockedViewingStatus={selectedMenu === 'Movies' ? 'Watched' : ''} lockedType={selectedMenu === 'Movies' ? 'movie' : selectedMenu === 'Series' ? 'series' : ''} onChange={setFilters} onClose={() => setShowFilters(false)} />}
    </section>
  );
};

export default Content;
