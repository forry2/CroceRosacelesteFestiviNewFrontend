import React, { useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Container, Grid, Paper, Typography, TextField, Button, Stack, Divider, Alert, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Box } from '@mui/material';
import * as XLSX from 'xlsx';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8080/api/festivi/assegna';

const theme = createTheme({
  palette: { mode: 'light', primary: { main: '#1565c0' }, secondary: { main: '#00897b' } },
  shape: { borderRadius: 10 }
});

function App() {
  const [file, setFile] = useState(null);
  const [startDate, setStartDate] = useState('2025-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [minProximityDays, setMinProximityDays] = useState(2);
  const [iframeSrc, setIframeSrc] = useState('about:blank');
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [assignedRows, setAssignedRows] = useState([]);
  const [assignedBlob, setAssignedBlob] = useState(null);
  const [inputFileName, setInputFileName] = useState('output');
  const [sortConfig, setSortConfig] = useState({ key: 'data', direction: 'asc' });
  const [weightsRows, setWeightsRows] = useState([]);
  const [weightsCols, setWeightsCols] = useState([]);
  const [eventsRows, setEventsRows] = useState([]);
  const [eventsCols, setEventsCols] = useState([]);
  const [heavyKeys, setHeavyKeys] = useState(new Set());
  const [heavyTeamMonths, setHeavyTeamMonths] = useState(new Set());
  const [error, setError] = useState('');

  const onFileChange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return setFile(null);
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError('Caricare solo file .xlsx');
      setFile(null);
      return;
    }
    setError('');
    setFile(f);
    setInputFileName(f.name.replace(/\.xlsx$/i, '') || 'output');
    // Precarica lo sheet festivi-pesanti per evidenziazione
    try {
      const ab = await f.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const wsH = wb.Sheets['festivi-pesanti'];
      if (wsH) {
        const jh = XLSX.utils.sheet_to_json(wsH, { defval: '' });
        const set = new Set(
          jh
            .filter(r => r['data'] && r['turno'])
            .map(r => `${String(r['data']).trim()}|${String(r['turno']).trim().toUpperCase()}`)
        );
        setHeavyKeys(set);
      } else {
        setHeavyKeys(new Set());
      }
    } catch (_) {
      setHeavyKeys(new Set());
    }
  };

  const onCalc = async (mode) => {
    setError('');
    if (!file) { setError('File .xlsx obbligatorio'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { setError('Date in formato YYYY-MM-DD'); return; }
    if (!Number.isInteger(Number(minProximityDays)) || Number(minProximityDays) < 0) { setError('minProximityDays deve essere intero >= 0'); return; }

    setLoading(true);
    // Pulisci le 3 tabelle immediatamente
    setAssignedRows([]);
    setWeightsRows([]); setWeightsCols([]);
    setEventsRows([]); setEventsCols([]);
    setAssignedBlob(null);
    setDownloadUrl('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('startDate', startDate);
      formData.append('endDate', endDate);
      formData.append('minProximityDays', String(minProximityDays));

      const url = `${API_BASE_URL}/${mode}`;
      const resp = await fetch(url, { method: 'POST', body: formData });
      if (!resp.ok) {
        const txt = await resp.text();
        setError(`Errore ${resp.status}: ${txt}`);
        setLoading(false);
        return;
      }
      // Riceviamo un Excel: salviamo il blob per download manuale; la vista è solo tabellare
      const blob = await resp.blob();
      setAssignedBlob(blob);
      setIframeSrc('about:blank');
      setDownloadUrl('');
      try {
        const ab = await blob.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const sheetName = wb.SheetNames.find(n => n === 'lista-festivi') || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const mappedBase = json.filter(r => r['data'] && r['turno']).map(r => ({
          data: r['data'],
          turno: r['turno'],
          peso: r['peso'],
          squadra: r['squadra assegnata']
        }));
        // marca righe pesanti e costruisci mappa (squadra, mese) per riepilogo eventi
        const toKey = (d,t) => `${d}|${t}`;
        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const H = heavyKeys;
        const teamMonthSet = new Set();
        const mapped = mappedBase.map(r => {
          const turnoUp = String(r.turno).toUpperCase();
          let heavy = H.has(toKey(r.data, turnoUp));
          if (turnoUp === 'MP') {
            const d = new Date(r.data);
            const dow = d.getDay();
            if (!heavy && (dow === 6 || dow === 0)) {
              const pair = new Date(d);
              pair.setDate(pair.getDate() + (dow === 6 ? 1 : -1));
              if (H.has(toKey(fmt(pair), 'MP'))) heavy = true;
            }
          }
          if (heavy) {
            const d = new Date(r.data);
            let monthIdx = d.getMonth();
            if (turnoUp === 'MP' && d.getDay() === 0) { const sat = new Date(d); sat.setDate(sat.getDate()-1); monthIdx = sat.getMonth(); }
            const team = Number(r.squadra);
            if (!Number.isNaN(team)) teamMonthSet.add(`${team}|${monthIdx}`);
          }
          return { ...r, turno: turnoUp, __heavy: heavy };
        });
        setAssignedRows(mapped);
        setHeavyTeamMonths(teamMonthSet);

        // Parse riepilogo-pesi
        const wsP = wb.Sheets['riepilogo-pesi'];
        if (wsP) {
          const jp = XLSX.utils.sheet_to_json(wsP, { defval: '' });
          setWeightsRows(jp);
          setWeightsCols(jp.length > 0 ? Object.keys(jp[0]) : []);
        } else { setWeightsRows([]); setWeightsCols([]); }
        // Parse riepilogo-eventi
        const wsE = wb.Sheets['riepilogo-eventi'];
        if (wsE) {
          const je = XLSX.utils.sheet_to_json(wsE, { defval: '' });
          setEventsRows(je);
          setEventsCols(je.length > 0 ? Object.keys(je[0]) : []);
        } else { setEventsRows([]); setEventsCols([]); }
      } catch (e) {
        console.warn('Impossibile parsare Excel per tabella immediata', e);
        setAssignedRows([]);
        setWeightsRows([]); setWeightsCols([]);
        setEventsRows([]); setEventsCols([]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const handleDownload = () => {
    if (!assignedBlob) return;
    const stamp = new Date();
    const ts = `${stamp.getFullYear()}${String(stamp.getMonth()+1).padStart(2,'0')}${String(stamp.getDate()).padStart(2,'0')}-${String(stamp.getHours()).padStart(2,'0')}${String(stamp.getMinutes()).padStart(2,'0')}${String(stamp.getSeconds()).padStart(2,'0')}`;
    const name = `${inputFileName}-${ts}.xlsx`;
    const url = URL.createObjectURL(assignedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  const weekday = (yyyyMMdd) => {
    const [y,m,d] = yyyyMMdd.split('-').map(Number);
    const idx = new Date(y, m-1, d).getDay();
    return ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][idx];
  };
  const sortedRows = React.useMemo(() => {
    const rows = [...assignedRows];
    const { key, direction } = sortConfig;
    const cmp = (a,b) => {
      if (key === 'data') return new Date(a.data) - new Date(b.data);
      if (key === 'peso' || key === 'squadra') return (Number(a[key]||0)) - (Number(b[key]||0));
      return String(a[key]||'').localeCompare(String(b[key]||''));
    };
    rows.sort((a,b) => direction === 'asc' ? cmp(a,b) : -cmp(a,b));
    return rows;
  }, [assignedRows, sortConfig]);
  const makeSortHandler = (key) => () => {
    setSortConfig(prev => {
      if (prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return { key, direction: 'asc' };
    });
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="xl" sx={{ py: 2, height: '100vh', overflow: 'hidden' }}>
        <Grid container spacing={2} sx={{ height: '100%' }}>
          <Grid item xs={12} md={5}>
            <Paper elevation={3} sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
              <Typography variant="h5" fontWeight={700}>Calcolo Turni Festivi</Typography>
              <Divider />
              <Stack spacing={2}>
                <Button variant="outlined" size="small" onClick={async ()=>{
                  try {
                    const resp = await fetch(`${API_BASE_URL}/template`);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const blob = await resp.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'festivi-template.xlsx';
                    document.body.appendChild(a); a.click(); a.remove();
                    URL.revokeObjectURL(url);
                  } catch (e) { setError(`Impossibile scaricare il template: ${e.message}`); }
                }}>Scarica template Excel di input</Button>
                <Button variant="outlined" component="label" title={file ? file.name : 'Carica Excel di input (.xlsx)'}>
                  {file ? file.name : 'Carica Excel di input (.xlsx)'}
                  <input hidden type="file" accept=".xlsx" onChange={onFileChange} />
                </Button>
                <TextField label="Data inizio (YYYY-MM-DD)" value={startDate} onChange={(e)=>setStartDate(e.target.value)} size="small" />
                <TextField label="Data fine (YYYY-MM-DD)" value={endDate} onChange={(e)=>setEndDate(e.target.value)} size="small" />
                <TextField label="Distanza minima (giorni)" type="number" value={minProximityDays} onChange={(e)=>setMinProximityDays(e.target.value)} size="small" />
                {error && <Alert severity="error">{error}</Alert>}
                <Stack direction="row" spacing={2} justifyContent="space-between">
                  <Button sx={{ flex:1 }} variant="contained" color="primary" disabled={loading} onClick={()=>onCalc('greedy')}>{loading ? '...' : 'Calcolo Greedy'}</Button>
                  <Button sx={{ flex:1 }} variant="contained" color="secondary" disabled={loading} onClick={()=>onCalc('milp')}>{loading ? '...' : 'Calcolo MILP'}</Button>
                </Stack>
                <Button variant="outlined" size="small" onClick={handleDownload} disabled={!assignedBlob}>Scarica Excel di output</Button>
              </Stack>
            </Paper>
          </Grid>
          <Grid item xs={12} md={7} sx={{ height: '100%' }}>
            <Paper elevation={3} sx={{ p: 1, height: '100%', display:'flex', flexDirection:'column', overflowY:'auto' }}>
              <Box sx={{ minHeight:0, flex:1, display:'flex', flexDirection:'column', gap:2 }}>
                {weightsRows.length > 0 && (
                  <Box>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Riepilogo Pesi</Typography>
                    <TableContainer>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            {weightsCols.map((c, i) => (<TableCell key={i}>{c}</TableCell>))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {weightsRows.map((row, idx) => (
                            <TableRow key={idx} hover>
                              {weightsCols.map((c, i) => (<TableCell key={i}>{row[c]}</TableCell>))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
                {eventsRows.length > 0 && (
                  <Box>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Riepilogo Eventi</Typography>
                    <TableContainer>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            {eventsCols.map((c, i) => (<TableCell key={i}>{c}</TableCell>))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {eventsRows.map((row, idx) => {
                            const team = Number(row['squadra'] ?? row['Squadra'] ?? row['squadra ']);
                            const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
                            return (
                              <TableRow key={idx} hover>
                                {eventsCols.map((c, i) => {
                                  const mi = MONTHS.indexOf(c);
                                  const highlight = mi >= 0 && heavyTeamMonths.has(`${team}|${mi}`) && Number(row[c]) > 0;
                                  return (
                                    <TableCell key={i} sx={highlight ? { fontWeight: 700, fontStyle: 'italic' } : undefined}>{row[c]}</TableCell>
                                  );
                                })}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
                <Typography variant="subtitle1" fontWeight={600} sx={{ px:1 }}>Risultati calcolo</Typography>
                {sortedRows.length > 0 && (
                  <TableContainer>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sortDirection={sortConfig.key==='data'?sortConfig.direction:false}>
                            <TableSortLabel active={sortConfig.key==='data'} direction={sortConfig.key==='data'?sortConfig.direction:'asc'} onClick={makeSortHandler('data')}>Data</TableSortLabel>
                          </TableCell>
                          <TableCell>Giorno</TableCell>
                          <TableCell sortDirection={sortConfig.key==='turno'?sortConfig.direction:false}>
                            <TableSortLabel active={sortConfig.key==='turno'} direction={sortConfig.key==='turno'?sortConfig.direction:'asc'} onClick={makeSortHandler('turno')}>Turno</TableSortLabel>
                          </TableCell>
                          <TableCell sortDirection={sortConfig.key==='peso'?sortConfig.direction:false}>
                            <TableSortLabel active={sortConfig.key==='peso'} direction={sortConfig.key==='peso'?sortConfig.direction:'asc'} onClick={makeSortHandler('peso')}>Peso</TableSortLabel>
                          </TableCell>
                          <TableCell sortDirection={sortConfig.key==='squadra'?sortConfig.direction:false}>
                            <TableSortLabel active={sortConfig.key==='squadra'} direction={sortConfig.key==='squadra'?sortConfig.direction:'asc'} onClick={makeSortHandler('squadra')}>Squadra</TableSortLabel>
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {sortedRows.map((r, i) => {
                          const cellSx = r.__heavy ? { fontWeight: 700, fontStyle: 'italic', backgroundColor: 'rgba(255, 215, 0, 0.15)' } : undefined;
                          return (
                            <TableRow key={i} hover>
                              <TableCell sx={cellSx}>{r.data}</TableCell>
                              <TableCell sx={cellSx}>{weekday(r.data)}</TableCell>
                              <TableCell sx={cellSx}>{r.turno}{r.__heavy ? ' ★' : ''}</TableCell>
                              <TableCell sx={cellSx}>{r.peso}</TableCell>
                              <TableCell sx={cellSx}>{r.squadra}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </ThemeProvider>
  );
}

export default App;


