(function(){
  "use strict";

  const USERS_KEY = 'gudang_users_v1';

  let currentUser = null; // {username}
  let items = [];
  let trx = [];
  let loaded = false;
  let pendingDeleteId = null;
  let loginMode = 'in'; // 'in' | 'up'
  let importRows = []; // parsed rows for preview

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function uid(prefix){
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  }
  function fmtNum(n){ return new Intl.NumberFormat('id-ID').format(n); }
  function fmtDate(iso){
    if(!iso) return '-';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('id-ID', {day:'2-digit', month:'short', year:'numeric'});
  }
  function todayISO(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function showToast(msg){
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._h);
    showToast._h = setTimeout(()=> t.classList.remove('show'), 2600);
  }
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function itemsKey(){ return 'gudang_items_v1__' + currentUser.username; }
  function trxKey(){ return 'gudang_trx_v1__' + currentUser.username; }

  // =================================================================
  // LOGIN / REGISTER
  // =================================================================
  // Penyimpanan lokal di browser (bertahan walau tab/aplikasi ditutup).
  // Sengaja tidak pakai window.storage karena API itu hanya aktif saat
  // file dibuka sebagai artifact Claude, bukan saat dibuka langsung
  // sebagai file HTML biasa — itulah penyebab bug "akun tidak ketemu".
  async function storageGet(key){
    try{
      const v = localStorage.getItem(key);
      return v !== null ? { value: v } : null;
    }catch(e){ return null; }
  }
  async function storageSet(key, value){
    localStorage.setItem(key, value);
    return { value };
  }

  async function getUsers(){
    try{
      const res = await storageGet(USERS_KEY);
      return res ? JSON.parse(res.value) : [];
    }catch(e){ return []; }
  }
  async function saveUsers(list){
    try{ await storageSet(USERS_KEY, JSON.stringify(list)); }
    catch(e){ showToast('Gagal menyimpan akun.'); }
  }

  function setLoginMode(mode){
    loginMode = mode;
    $('#tabLoginIn').classList.toggle('active', mode === 'in');
    $('#tabLoginUp').classList.toggle('active', mode === 'up');
    $('#btnLoginSubmit').textContent = mode === 'in' ? 'Masuk' : 'Daftar & masuk';
    $('#loginError').classList.remove('show');
  }
  $('#tabLoginIn').addEventListener('click', ()=> setLoginMode('in'));
  $('#tabLoginUp').addEventListener('click', ()=> setLoginMode('up'));

  function loginErr(msg){
    $('#loginError').textContent = msg;
    $('#loginError').classList.add('show');
  }

  async function handleLoginSubmit(){
    const username = $('#loginUsername').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    if(!username || !password){
      loginErr('Nama pengguna dan kata sandi wajib diisi.');
      return;
    }
    if(!/^[a-z0-9_.-]{3,20}$/.test(username)){
      loginErr('Nama pengguna 3-20 karakter, huruf/angka/underscore saja.');
      return;
    }
    $('#btnLoginSubmit').disabled = true;
    const prevLabel = $('#btnLoginSubmit').textContent;
    $('#btnLoginSubmit').textContent = 'Memproses…';
    const users = await getUsers();
    const existing = users.find(u=> u.username === username);

    if(loginMode === 'up'){
      if(existing){
        loginErr('Nama pengguna sudah dipakai. Coba masuk, atau pilih nama lain.');
        $('#btnLoginSubmit').disabled = false;
        $('#btnLoginSubmit').textContent = prevLabel;
        return;
      }
      if(password.length < 4){
        loginErr('Kata sandi minimal 4 karakter.');
        $('#btnLoginSubmit').disabled = false;
        $('#btnLoginSubmit').textContent = prevLabel;
        return;
      }
      users.push({ username, password });
      await saveUsers(users);
      await enterApp(username);
    } else {
      if(!existing || existing.password !== password){
        loginErr('Nama pengguna atau kata sandi salah.');
        $('#btnLoginSubmit').disabled = false;
        $('#btnLoginSubmit').textContent = prevLabel;
        return;
      }
      await enterApp(username);
    }
    $('#btnLoginSubmit').disabled = false;
    $('#btnLoginSubmit').textContent = prevLabel;
  }
  $('#btnLoginSubmit').addEventListener('click', handleLoginSubmit);
  $('#loginPassword').addEventListener('keydown', (e)=>{ if(e.key === 'Enter') handleLoginSubmit(); });
  $('#loginUsername').addEventListener('keydown', (e)=>{ if(e.key === 'Enter') handleLoginSubmit(); });

  async function enterApp(username){
    currentUser = { username };
    $('#loginScreen').style.display = 'none';
    $('#appRoot').classList.add('active', 'loading');
    $('#currentUserLabel').textContent = username;
    $('#userAvatar').textContent = username.charAt(0).toUpperCase();
    $('#loginUsername').value = '';
    $('#loginPassword').value = '';
    await loadData();
    renderTodayChip();
    renderAll();
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=> $('#appRoot').classList.remove('loading'));
    });
  }

  function logout(){
    currentUser = null;
    items = []; trx = []; loaded = false;
    $('#appRoot').classList.remove('active');
    $('#loginScreen').style.display = 'flex';
    setActiveTab('dashboard', true);
    setLoginMode('in');
  }
  $('#btnLogout').addEventListener('click', logout);

  // =================================================================
  // STORAGE (scoped per logged-in user)
  // =================================================================
  async function loadData(){
    try{
      const res = await storageGet(itemsKey());
      items = res ? JSON.parse(res.value) : [];
    }catch(e){ items = []; }
    try{
      const res = await storageGet(trxKey());
      trx = res ? JSON.parse(res.value) : [];
    }catch(e){ trx = []; }
    loaded = true;
  }
  async function saveItems(){
    try{ await storageSet(itemsKey(), JSON.stringify(items)); }
    catch(e){ showToast('Gagal menyimpan data barang.'); }
  }
  async function saveTrx(){
    try{ await storageSet(trxKey(), JSON.stringify(trx)); }
    catch(e){ showToast('Gagal menyimpan transaksi.'); }
  }

  // =================================================================
  // TABS
  // =================================================================
  function setActiveTab(name, skipRender){
    $$('.tabs button[data-tab]').forEach(b=> b.classList.toggle('active', b.dataset.tab === name));
    $$('.view').forEach(v=> v.classList.toggle('active', v.id === 'view-' + name));
    if(!skipRender) renderAll();
  }
  $$('.tabs button[data-tab]').forEach(b=> b.addEventListener('click', ()=> setActiveTab(b.dataset.tab)));
  $$('[data-tab-link]').forEach(b=> b.addEventListener('click', ()=> setActiveTab(b.dataset.tabLink)));

  function renderTodayChip(){
    const d = new Date();
    $('#todayChip').textContent = d.toLocaleDateString('id-ID', {weekday:'long', day:'2-digit', month:'long', year:'numeric'});
  }

  // =================================================================
  // DASHBOARD
  // =================================================================
  function renderDashboard(){
    const totalItems = items.length;
    const totalStok = items.reduce((s,i)=> s + i.stok, 0);
    const lowStock = items.filter(i=> i.stok <= i.stokMin);
    const todayStr = todayISO();
    const trxToday = trx.filter(t=> t.tanggal === todayStr);
    const masukToday = trxToday.filter(t=> t.tipe === 'masuk').reduce((s,t)=> s + t.qty, 0);
    const keluarToday = trxToday.filter(t=> t.tipe === 'keluar').reduce((s,t)=> s + t.qty, 0);

    $('#statGrid').innerHTML = `
      <div class="stat-card">
        <div class="label">Jenis barang</div>
        <div class="value">${fmtNum(totalItems)}</div>
        <div class="sub">Total unit stok: ${fmtNum(totalStok)}</div>
      </div>
      <div class="stat-card ${lowStock.length ? 'accent-warn' : ''}">
        <div class="label">Stok menipis</div>
        <div class="value">${fmtNum(lowStock.length)}</div>
        <div class="sub">Barang di bawah stok minimum</div>
      </div>
      <div class="stat-card">
        <div class="label">Masuk hari ini</div>
        <div class="value" style="color:var(--in);">+${fmtNum(masukToday)}</div>
        <div class="sub">${fmtNum(trxToday.filter(t=>t.tipe==='masuk').length)} transaksi</div>
      </div>
      <div class="stat-card">
        <div class="label">Keluar hari ini</div>
        <div class="value" style="color:var(--out);">-${fmtNum(keluarToday)}</div>
        <div class="sub">${fmtNum(trxToday.filter(t=>t.tipe==='keluar').length)} transaksi</div>
      </div>
    `;

    if(lowStock.length === 0){
      $('#lowStockList').innerHTML = `<div class="empty-state"><div class="big">Semua stok aman</div><p>Tidak ada barang di bawah batas minimum saat ini.</p></div>`;
    } else {
      $('#lowStockList').innerHTML = `<table><thead><tr><th>Kode</th><th>Nama barang</th><th>Kategori</th><th>Stok</th><th>Min.</th></tr></thead><tbody>` +
        lowStock.slice(0,8).map(i=> `
          <tr>
            <td data-label="Kode" class="mono item-code-cell">${escapeHtml(i.kode)}</td>
            <td data-label="Nama" class="item-name-cell">${escapeHtml(i.nama)}</td>
            <td data-label="Kategori">${escapeHtml(i.kategori||'-')}</td>
            <td data-label="Stok" class="num" style="color:var(--warn);font-weight:600;">${fmtNum(i.stok)} ${escapeHtml(i.satuan||'')}</td>
            <td data-label="Min." class="num">${fmtNum(i.stokMin)}</td>
          </tr>
        `).join('') + `</tbody></table>`;
    }

    const recent = [...trx].sort((a,b)=> b.createdAt - a.createdAt).slice(0,8);
    if(recent.length === 0){
      $('#recentTrxList').innerHTML = `<div class="empty-state"><div class="big">Belum ada transaksi</div><p>Catat barang masuk atau keluar pertama Anda di tab Catat Transaksi.</p></div>`;
    } else {
      $('#recentTrxList').innerHTML = renderTrxTable(recent);
    }
  }

  // =================================================================
  // BARANG
  // =================================================================
  function itemsFiltered(){
    const q = ($('#searchBarang').value || '').trim().toLowerCase();
    if(!q) return items;
    return items.filter(i=> i.nama.toLowerCase().includes(q) || i.kode.toLowerCase().includes(q));
  }
  function gaugeColor(i){
    if(i.stok <= i.stokMin) return 'var(--warn)';
    if(i.stok <= i.stokMin * 2) return 'var(--primary)';
    return 'var(--in)';
  }
  function renderBarang(){
    const list = itemsFiltered();
    if(items.length === 0){
      $('#barangTableWrap').innerHTML = `<div class="empty-state"><div class="big">Belum ada barang</div><p>Tambahkan barang satu per satu, atau impor banyak sekaligus dari Excel.</p></div>`;
      return;
    }
    if(list.length === 0){
      $('#barangTableWrap').innerHTML = `<div class="empty-state"><div class="big">Tidak ditemukan</div><p>Coba kata kunci pencarian lain.</p></div>`;
      return;
    }
    const maxStok = Math.max(...items.map(i=> Math.max(i.stok, i.stokMin, 1)));
    $('#barangTableWrap').innerHTML = `<table><thead><tr>
        <th>Kode</th><th>Nama barang</th><th>Kategori</th><th>Stok</th><th>Level</th><th></th>
      </tr></thead><tbody>` +
      list.map(i=>{
        const pct = Math.min(100, Math.round((i.stok / maxStok) * 100));
        const low = i.stok <= i.stokMin;
        return `<tr>
          <td data-label="Kode" class="mono item-code-cell">${escapeHtml(i.kode)}</td>
          <td data-label="Nama" class="item-name-cell">${escapeHtml(i.nama)}</td>
          <td data-label="Kategori">${escapeHtml(i.kategori||'-')}</td>
          <td data-label="Stok" class="num">${fmtNum(i.stok)} ${escapeHtml(i.satuan||'')} ${low ? '<div class="tag-low">rendah</div>' : `<div class="tag-ok">min ${fmtNum(i.stokMin)}</div>`}</td>
          <td data-label="Level"><div class="gauge"><div class="gauge-track"><div class="gauge-fill" data-pct="${pct}" style="background:${gaugeColor(i)};"></div></div><div class="gauge-label">${pct}%</div></div></td>
          <td data-label="Aksi" style="text-align:right;white-space:nowrap;">
            <button class="btn-ghost btn-sm btn" data-edit="${i.id}">Edit</button>
            <button class="btn-danger-ghost btn-sm btn" data-del="${i.id}">Hapus</button>
          </td>
        </tr>`;
      }).join('') + `</tbody></table>`;

    $$('[data-edit]').forEach(b=> b.addEventListener('click', ()=> openBarangModal(b.dataset.edit)));
    $$('[data-del]').forEach(b=> b.addEventListener('click', ()=> confirmDeleteItem(b.dataset.del)));
    requestAnimationFrame(()=>{
      $$('.gauge-fill').forEach(el=>{ el.style.width = el.dataset.pct + '%'; });
    });
  }
  function confirmDeleteItem(id){
    const item = items.find(i=> i.id === id);
    if(!item) return;
    pendingDeleteId = id;
    $('#confirmText').textContent = `"${item.nama}" beserta seluruh riwayat transaksinya akan dihapus permanen.`;
    $('#modalConfirm').classList.add('active');
  }

  function openBarangModal(id){
    $('#errBarang').classList.remove('show');
    if(id){
      const it = items.find(i=> i.id === id);
      if(!it) return;
      $('#modalBarangTitle').textContent = 'Edit barang';
      $('#barangId').value = it.id;
      $('#fKode').value = it.kode;
      $('#fKategori').value = it.kategori || '';
      $('#fNama').value = it.nama;
      $('#fSatuan').value = it.satuan || '';
      $('#fStokMin').value = it.stokMin;
      $('#fStokAwal').value = it.stok;
      $('#lblStokAwal').textContent = 'Stok saat ini';
      $('#stokAwalHelper').textContent = 'Ubah nilai ini hanya untuk koreksi stok. Untuk transaksi normal, gunakan Catat Transaksi.';
    } else {
      $('#modalBarangTitle').textContent = 'Tambah barang';
      $('#barangId').value = '';
      $('#fKode').value = '';
      $('#fKategori').value = '';
      $('#fNama').value = '';
      $('#fSatuan').value = '';
      $('#fStokMin').value = 0;
      $('#fStokAwal').value = 0;
      $('#lblStokAwal').textContent = 'Stok awal';
      $('#stokAwalHelper').textContent = 'Jumlah stok saat barang pertama kali didata.';
    }
    $('#modalBarang').classList.add('active');
    $('#fKode').focus();
  }
  function closeBarangModal(){ $('#modalBarang').classList.remove('active'); }

  async function saveBarang(){
    const id = $('#barangId').value;
    const kode = $('#fKode').value.trim();
    const kategori = $('#fKategori').value.trim();
    const nama = $('#fNama').value.trim();
    const satuan = $('#fSatuan').value.trim();
    const stokMin = parseInt($('#fStokMin').value, 10) || 0;
    const stokAwal = parseInt($('#fStokAwal').value, 10) || 0;

    if(!kode || !nama){
      $('#errBarang').textContent = 'Kode dan nama barang wajib diisi.';
      $('#errBarang').classList.add('show');
      return;
    }
    const dup = items.find(i=> i.kode.toLowerCase() === kode.toLowerCase() && i.id !== id);
    if(dup){
      $('#errBarang').textContent = 'Kode barang sudah digunakan. Gunakan kode lain.';
      $('#errBarang').classList.add('show');
      return;
    }
    if(stokAwal < 0 || stokMin < 0){
      $('#errBarang').textContent = 'Stok tidak boleh bernilai negatif.';
      $('#errBarang').classList.add('show');
      return;
    }

    if(id){
      const it = items.find(i=> i.id === id);
      it.kode = kode; it.kategori = kategori; it.nama = nama; it.satuan = satuan;
      it.stokMin = stokMin; it.stok = stokAwal;
    } else {
      items.push({ id: uid('brg'), kode, kategori, nama, satuan, stok: stokAwal, stokMin });
    }
    await saveItems();
    closeBarangModal();
    showToast('Barang disimpan.');
    renderAll();
  }

  async function doDeleteItem(){
    if(!pendingDeleteId) return;
    items = items.filter(i=> i.id !== pendingDeleteId);
    trx = trx.filter(t=> t.itemId !== pendingDeleteId);
    await saveItems();
    await saveTrx();
    pendingDeleteId = null;
    $('#modalConfirm').classList.remove('active');
    showToast('Barang dihapus.');
    renderAll();
  }

  // =================================================================
  // TRANSAKSI
  // =================================================================
  function renderTrxTable(list){
    return `<table><thead><tr><th>Tanggal</th><th>Tipe</th><th>Barang</th><th>Jumlah</th><th>Pihak</th><th>Keterangan</th></tr></thead><tbody>` +
      list.map(t=>{
        const item = items.find(i=> i.id === t.itemId);
        return `<tr>
          <td data-label="Tanggal" class="mono">${fmtDate(t.tanggal)}</td>
          <td data-label="Tipe"><span class="stamp ${t.tipe}">${t.tipe === 'masuk' ? 'Masuk' : 'Keluar'}</span></td>
          <td data-label="Barang" class="item-name-cell">${escapeHtml(item ? item.nama : '(barang dihapus)')}</td>
          <td data-label="Jumlah" class="num" style="color:${t.tipe==='masuk' ? 'var(--in)' : 'var(--out)'};font-weight:600;">${t.tipe==='masuk'?'+':'-'}${fmtNum(t.qty)} ${item ? escapeHtml(item.satuan||'') : ''}</td>
          <td data-label="Pihak">${escapeHtml(t.pihak || '-')}</td>
          <td data-label="Keterangan" style="color:var(--ink-soft);">${escapeHtml(t.keterangan || '-')}</td>
        </tr>`;
      }).join('') + `</tbody></table>`;
  }

  function renderTransaksiTab(){
    const todayStr = todayISO();
    const list = trx.filter(t=> t.tanggal === todayStr).sort((a,b)=> b.createdAt - a.createdAt);
    if(list.length === 0){
      $('#todayTrxList').innerHTML = `<div class="empty-state"><div class="big">Belum ada transaksi hari ini</div><p>Gunakan tombol di atas untuk mencatat barang masuk atau keluar.</p></div>`;
    } else {
      $('#todayTrxList').innerHTML = renderTrxTable(list);
    }
  }

  function populateItemSelect(){
    const sel = $('#fTrxItem');
    if(items.length === 0){
      sel.innerHTML = `<option value="">Belum ada barang</option>`;
      return;
    }
    sel.innerHTML = items.map(i=> `<option value="${i.id}">${escapeHtml(i.kode)} — ${escapeHtml(i.nama)} (stok: ${fmtNum(i.stok)} ${escapeHtml(i.satuan||'')})</option>`).join('');
  }

  function openTrxModal(tipe){
    if(items.length === 0){
      showToast('Tambahkan barang terlebih dahulu di tab Data Barang.');
      setActiveTab('barang');
      return;
    }
    $('#errTrx').classList.remove('show');
    $('#trxTipe').value = tipe;
    $('#modalTrxTitle').textContent = tipe === 'masuk' ? 'Barang masuk' : 'Barang keluar';
    $('#lblPihak').textContent = tipe === 'masuk' ? 'Dari supplier' : 'Untuk / tujuan';
    $('#fTrxPihak').placeholder = tipe === 'masuk' ? 'Nama supplier' : 'Nama pelanggan / proyek';
    populateItemSelect();
    $('#fTrxQty').value = 1;
    $('#fTrxTanggal').value = todayISO();
    $('#fTrxPihak').value = '';
    $('#fTrxKet').value = '';
    $('#modalTrx').classList.add('active');
  }
  function closeTrxModal(){ $('#modalTrx').classList.remove('active'); }

  async function saveTrxEntry(){
    const tipe = $('#trxTipe').value;
    const itemId = $('#fTrxItem').value;
    const qty = parseInt($('#fTrxQty').value, 10);
    const tanggal = $('#fTrxTanggal').value;
    const pihak = $('#fTrxPihak').value.trim();
    const keterangan = $('#fTrxKet').value.trim();

    const item = items.find(i=> i.id === itemId);
    if(!item){
      $('#errTrx').textContent = 'Pilih barang terlebih dahulu.';
      $('#errTrx').classList.add('show');
      return;
    }
    if(!qty || qty <= 0){
      $('#errTrx').textContent = 'Jumlah harus lebih besar dari 0.';
      $('#errTrx').classList.add('show');
      return;
    }
    if(!tanggal){
      $('#errTrx').textContent = 'Tanggal wajib diisi.';
      $('#errTrx').classList.add('show');
      return;
    }
    if(tipe === 'keluar' && qty > item.stok){
      $('#errTrx').textContent = `Stok tidak cukup. Stok tersedia: ${fmtNum(item.stok)} ${item.satuan||''}.`;
      $('#errTrx').classList.add('show');
      return;
    }

    if(tipe === 'masuk') item.stok += qty; else item.stok -= qty;
    trx.push({ id: uid('trx'), itemId, tipe, qty, tanggal, pihak, keterangan, createdAt: Date.now() });

    await saveItems();
    await saveTrx();
    closeTrxModal();
    showToast(tipe === 'masuk' ? 'Barang masuk dicatat.' : 'Barang keluar dicatat.');
    renderAll();
  }

  // =================================================================
  // RIWAYAT
  // =================================================================
  function getFilteredRiwayat(){
    const q = ($('#searchRiwayat').value || '').trim().toLowerCase();
    const tipe = $('#filterTipe').value;
    const tgl = $('#filterTanggal').value;

    let list = [...trx].sort((a,b)=> b.createdAt - a.createdAt);
    if(tipe) list = list.filter(t=> t.tipe === tipe);
    if(tgl) list = list.filter(t=> t.tanggal === tgl);
    if(q){
      list = list.filter(t=>{
        const item = items.find(i=> i.id === t.itemId);
        return item && (item.nama.toLowerCase().includes(q) || item.kode.toLowerCase().includes(q));
      });
    }
    return list;
  }

  function renderRiwayat(){
    const list = getFilteredRiwayat();
    if(trx.length === 0){
      $('#riwayatTableWrap').innerHTML = `<div class="empty-state"><div class="big">Belum ada riwayat</div><p>Transaksi yang Anda catat akan muncul di sini.</p></div>`;
      return;
    }
    if(list.length === 0){
      $('#riwayatTableWrap').innerHTML = `<div class="empty-state"><div class="big">Tidak ditemukan</div><p>Coba ubah kata kunci atau filter.</p></div>`;
      return;
    }
    $('#riwayatTableWrap').innerHTML = renderTrxTable(list);
  }

  // ---------- Export riwayat ----------
  function exportRowsData(){
    const list = getFilteredRiwayat();
    return list.map(t=>{
      const item = items.find(i=> i.id === t.itemId);
      return {
        tanggal: fmtDate(t.tanggal),
        tipe: t.tipe === 'masuk' ? 'Masuk' : 'Keluar',
        kode: item ? item.kode : '-',
        nama: item ? item.nama : '(barang dihapus)',
        jumlah: t.qty,
        satuan: item ? (item.satuan||'') : '',
        pihak: t.pihak || '-',
        keterangan: t.keterangan || '-'
      };
    });
  }

  function exportExcel(){
    const rows = exportRowsData();
    if(rows.length === 0){ showToast('Tidak ada data untuk diunduh.'); return; }
    const totalMasuk = rows.filter(r=>r.tipe==='Masuk').reduce((s,r)=>s+r.jumlah,0);
    const totalKeluar = rows.filter(r=>r.tipe==='Keluar').reduce((s,r)=>s+r.jumlah,0);
    const aoa = [
      ['Laporan Riwayat Transaksi Gudang'],
      ['Pengguna', currentUser.username],
      ['Dicetak', new Date().toLocaleString('id-ID')],
      [],
      ['Tanggal','Tipe','Kode','Nama Barang','Jumlah','Satuan','Pihak','Keterangan'],
      ...rows.map(r=> [r.tanggal, r.tipe, r.kode, r.nama, r.jumlah, r.satuan, r.pihak, r.keterangan]),
      [],
      ['Total masuk', totalMasuk],
      ['Total keluar', totalKeluar]
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:12},{wch:8},{wch:12},{wch:26},{wch:8},{wch:8},{wch:18},{wch:26}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Riwayat');
    XLSX.writeFile(wb, `riwayat_gudang_${currentUser.username}_${todayISO()}.xlsx`);
    showToast('Laporan Excel diunduh.');
  }

  function exportPdf(){
    const rows = exportRowsData();
    if(rows.length === 0){ showToast('Tidak ada data untuk diunduh.'); return; }
    const totalMasuk = rows.filter(r=>r.tipe==='Masuk').reduce((s,r)=>s+r.jumlah,0);
    const totalKeluar = rows.filter(r=>r.tipe==='Keluar').reduce((s,r)=>s+r.jumlah,0);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape' });
    doc.setFontSize(14);
    doc.text('Laporan Riwayat Transaksi Gudang', 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(90,90,90);
    doc.text(`Pengguna: ${currentUser.username}`, 14, 21);
    doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, 14, 26);

    doc.autoTable({
      startY: 31,
      head: [['Tanggal','Tipe','Kode','Nama Barang','Jumlah','Satuan','Pihak','Keterangan']],
      body: rows.map(r=> [r.tanggal, r.tipe, r.kode, r.nama, r.jumlah, r.satuan, r.pihak, r.keterangan]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [31,58,82], textColor: 255 },
      alternateRowStyles: { fillColor: [241,243,241] }
    });

    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.setTextColor(20,24,27);
    doc.text(`Total barang masuk: ${totalMasuk}`, 14, finalY);
    doc.text(`Total barang keluar: ${totalKeluar}`, 14, finalY + 6);

    doc.save(`riwayat_gudang_${currentUser.username}_${todayISO()}.pdf`);
    showToast('Laporan PDF diunduh.');
  }

  // =================================================================
  // EXCEL IMPORT
  // =================================================================
  function normalizeHeader(h){
    return String(h||'').trim().toLowerCase().replace(/[\s.]+/g,'_');
  }
  const HEADER_MAP = {
    kode: ['kode','kode_barang','sku','kode barang'],
    nama: ['nama','nama_barang','nama barang','name'],
    kategori: ['kategori','category'],
    satuan: ['satuan','unit'],
    stok: ['stok','stock','stok_awal','qty','jumlah'],
    stokMin: ['stok_min','stok_minimum','min','minimum','stok min']
  };
  function findField(row, field){
    const keys = Object.keys(row);
    for(const alias of HEADER_MAP[field]){
      const found = keys.find(k=> normalizeHeader(k) === alias.replace(/\s+/g,'_'));
      if(found !== undefined) return row[found];
    }
    return undefined;
  }

  function openImportModal(){
    importRows = [];
    $('#errImport').classList.remove('show');
    $('#importStep1').style.display = 'block';
    $('#importStep2').style.display = 'none';
    $('#btnConfirmImport').style.display = 'none';
    $('#fileInputExcel').value = '';
    $('#modalImport').classList.add('active');
  }
  function closeImportModal(){ $('#modalImport').classList.remove('active'); }

  $('#btnImportExcel').addEventListener('click', openImportModal);
  $('#btnCancelImport').addEventListener('click', closeImportModal);
  $('#modalImport').addEventListener('click', (e)=>{ if(e.target.id === 'modalImport') closeImportModal(); });
  $('#btnChooseFile').addEventListener('click', ()=> $('#fileInputExcel').click());

  $('#btnDownloadTemplate').addEventListener('click', ()=>{
    const wsData = [
      ['kode','nama','kategori','satuan','stok','stok_min'],
      ['BRG-001','Kabel HDMI 2m','Elektronik','pcs',50,10],
      ['BRG-002','Kertas A4 80gr','Alat Tulis','rim',20,5]
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'template_barang.xlsx');
  });

  $('#fileInputExcel').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    $('#errImport').classList.remove('show');
    const reader = new FileReader();
    reader.onload = function(ev){
      try{
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
        processImportRows(rows);
      }catch(err){
        $('#errImport').textContent = 'Gagal membaca file. Pastikan formatnya .xlsx, .xls, atau .csv yang valid.';
        $('#errImport').classList.add('show');
      }
    };
    reader.onerror = function(){
      $('#errImport').textContent = 'Gagal membaca file.';
      $('#errImport').classList.add('show');
    };
    reader.readAsArrayBuffer(file);
  });

  function processImportRows(rows){
    if(!rows || rows.length === 0){
      $('#errImport').textContent = 'File kosong atau tidak berisi data.';
      $('#errImport').classList.add('show');
      return;
    }
    const seenKode = new Set();
    importRows = rows.map((row, idx)=>{
      const kode = String(findField(row,'kode') ?? '').trim();
      const nama = String(findField(row,'nama') ?? '').trim();
      const kategori = String(findField(row,'kategori') ?? '').trim();
      const satuan = String(findField(row,'satuan') ?? '').trim();
      let stok = parseInt(findField(row,'stok'), 10);
      let stokMin = parseInt(findField(row,'stokMin'), 10);
      if(isNaN(stok)) stok = 0;
      if(isNaN(stokMin)) stokMin = 0;

      let status = 'new';
      let reason = '';
      if(!kode || !nama){
        status = 'skip'; reason = 'Kode/nama kosong';
      } else if(seenKode.has(kode.toLowerCase())){
        status = 'skip'; reason = 'Duplikat di file';
      } else if(items.find(i=> i.kode.toLowerCase() === kode.toLowerCase())){
        status = 'update';
      }
      if(kode) seenKode.add(kode.toLowerCase());

      return { rowIndex: idx, kode, nama, kategori, satuan, stok, stokMin, status, reason, checked: status !== 'skip' };
    });

    renderImportPreview();
  }

  function renderImportPreview(){
    $('#importStep1').style.display = 'none';
    $('#importStep2').style.display = 'block';
    $('#btnConfirmImport').style.display = 'inline-flex';

    const newCount = importRows.filter(r=> r.status==='new').length;
    const updateCount = importRows.filter(r=> r.status==='update').length;
    const skipCount = importRows.filter(r=> r.status==='skip').length;
    $('#importSummary').innerHTML = `
      <span><b>${fmtNum(importRows.length)}</b> baris terbaca</span>
      <span style="color:var(--in);"><b>${fmtNum(newCount)}</b> baru</span>
      <span style="color:var(--primary);"><b>${fmtNum(updateCount)}</b> akan diperbarui</span>
      <span style="color:var(--danger);"><b>${fmtNum(skipCount)}</b> dilewati</span>
    `;

    $('#importPreviewBody').innerHTML = importRows.map(r=>{
      const badge = r.status === 'new' ? '<span class="tag-new">Baru</span>'
        : r.status === 'update' ? '<span class="tag-update">Perbarui</span>'
        : `<span class="tag-skip">Lewati${r.reason ? ': '+escapeHtml(r.reason) : ''}</span>`;
      return `<tr>
        <td><input type="checkbox" data-row="${r.rowIndex}" ${r.checked ? 'checked':''} ${r.status==='skip' ? 'disabled':''}></td>
        <td class="mono">${escapeHtml(r.kode)}</td>
        <td>${escapeHtml(r.nama)}</td>
        <td>${escapeHtml(r.kategori||'-')}</td>
        <td>${escapeHtml(r.satuan||'-')}</td>
        <td class="num">${fmtNum(r.stok)}</td>
        <td class="num">${fmtNum(r.stokMin)}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');

    $$('#importPreviewBody input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        const row = importRows.find(r=> r.rowIndex === parseInt(cb.dataset.row,10));
        if(row) row.checked = cb.checked;
      });
    });
  }

  $('#btnConfirmImport').addEventListener('click', async ()=>{
    const toImport = importRows.filter(r=> r.checked && r.status !== 'skip');
    if(toImport.length === 0){
      showToast('Tidak ada baris yang dipilih untuk diimpor.');
      return;
    }
    let added = 0, updated = 0;
    toImport.forEach(r=>{
      const existing = items.find(i=> i.kode.toLowerCase() === r.kode.toLowerCase());
      if(existing){
        existing.nama = r.nama || existing.nama;
        existing.kategori = r.kategori || existing.kategori;
        existing.satuan = r.satuan || existing.satuan;
        existing.stok = r.stok;
        existing.stokMin = r.stokMin;
        updated++;
      } else {
        items.push({ id: uid('brg'), kode: r.kode, nama: r.nama, kategori: r.kategori, satuan: r.satuan, stok: r.stok, stokMin: r.stokMin });
        added++;
      }
    });
    await saveItems();
    closeImportModal();
    showToast(`Impor selesai: ${added} barang baru, ${updated} diperbarui.`);
    renderAll();
  });

  // =================================================================
  // RENDER ORCHESTRATION
  // =================================================================
  function renderAll(){
    if(!loaded) return;
    renderDashboard();
    renderBarang();
    renderTransaksiTab();
    renderRiwayat();
  }

  // =================================================================
  // WIRE UP OTHER EVENTS
  // =================================================================
  $('#btnAddBarang').addEventListener('click', ()=> openBarangModal(null));
  $('#btnCancelBarang').addEventListener('click', closeBarangModal);
  $('#btnSaveBarang').addEventListener('click', saveBarang);
  $('#modalBarang').addEventListener('click', (e)=>{ if(e.target.id === 'modalBarang') closeBarangModal(); });

  $('#btnGoMasuk').addEventListener('click', ()=> openTrxModal('masuk'));
  $('#btnGoKeluar').addEventListener('click', ()=> openTrxModal('keluar'));
  $('#btnCancelTrx').addEventListener('click', closeTrxModal);
  $('#btnSaveTrx').addEventListener('click', saveTrxEntry);
  $('#modalTrx').addEventListener('click', (e)=>{ if(e.target.id === 'modalTrx') closeTrxModal(); });

  $('#btnCancelConfirm').addEventListener('click', ()=>{ pendingDeleteId = null; $('#modalConfirm').classList.remove('active'); });
  $('#btnDoConfirm').addEventListener('click', doDeleteItem);
  $('#modalConfirm').addEventListener('click', (e)=>{ if(e.target.id === 'modalConfirm'){ pendingDeleteId = null; e.currentTarget.classList.remove('active'); } });

  $('#searchBarang').addEventListener('input', renderBarang);
  $('#searchRiwayat').addEventListener('input', renderRiwayat);
  $('#filterTipe').addEventListener('change', renderRiwayat);
  $('#filterTanggal').addEventListener('change', renderRiwayat);
  $('#btnClearFilter').addEventListener('click', ()=>{
    $('#searchRiwayat').value=''; $('#filterTipe').value=''; $('#filterTanggal').value='';
    renderRiwayat();
  });
  $('#btnExportExcel').addEventListener('click', exportExcel);
  $('#btnExportPdf').addEventListener('click', exportPdf);

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      closeBarangModal(); closeTrxModal(); closeImportModal();
      $('#modalConfirm').classList.remove('active');
    }
  });

})();
