// ==== ESTADO ====
let registros = [];       // todos los registros traídos del servidor
let tratamiento = {};     // esquema indicado por la diabetóloga
let rangoActivo = 'hoy';
let chart = null;

// ==== UTILIDADES DE FECHA ====
function hoyStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}
function sumarDias(fechaStr, dias) {
  const d = new Date(fechaStr + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}
function primerDiaMes(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function formatFechaLarga(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ==== JSONP HELPER (mismo patrón que otros proyectos) ====
function jsonpCall(params) {
  return new Promise((resolve, reject) => {
    const callbackName = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    const query = new URLSearchParams({ ...params, callback: callbackName }).toString();
    script.src = `${CONFIG.API_URL}?${query}`;

    window[callbackName] = (response) => {
      resolve(response);
      delete window[callbackName];
      script.remove();
    };
    script.onerror = () => {
      reject(new Error('No se pudo conectar con el servidor. Revisá la URL en config.js'));
      delete window[callbackName];
      script.remove();
    };
    document.body.appendChild(script);
  });
}

// ==== CARGA DE DATOS ====
// Normaliza fecha/hora: a veces Sheets devuelve un datetime ISO completo
// (por auto-detección de tipo de columna) en vez de "yyyy-MM-dd" / "HH:mm".
// Usamos los componentes UTC porque esas fechas quedan ancladas a medianoche
// local convertida a UTC, así que no se corren de día.
function normalizarFecha(v) {
  if (!v) return v;
  if (typeof v === 'string' && v.includes('T')) {
    const d = new Date(v);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return v;
}
function normalizarHora(v) {
  if (!v) return v;
  if (typeof v === 'string' && v.includes('T')) {
    const d = new Date(v);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${mi}`;
  }
  return v;
}

async function cargarRegistros() {
  try {
    const res = await jsonpCall({ action: 'getRegistros' });
    if (!res.ok) throw new Error(res.error);
    registros = res.data.map(r => ({
      ...r,
      fecha: normalizarFecha(r.fecha),
      hora: normalizarHora(r.hora)
    }));
    render();
  } catch (err) {
    document.getElementById('lista').innerHTML = `<div class="empty">⚠ ${err.message}</div>`;
  }
}

// ==== ESQUEMA DE TRATAMIENTO ====
let escalaCorreccion = []; // [{desde, hasta, unidades}]

async function cargarTratamiento() {
  try {
    const res = await jsonpCall({ action: 'getTratamiento' });
    if (!res.ok) throw new Error(res.error);
    tratamiento = res.data;
    if (tratamiento.ActualizadoFecha && String(tratamiento.ActualizadoFecha).includes('T')) {
      const d = new Date(tratamiento.ActualizadoFecha);
      const pad = n => String(n).padStart(2, '0');
      tratamiento.ActualizadoFecha = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    escalaCorreccion = parseEscala(tratamiento.EscalaCorreccion || '');
    renderEsquema();
    if (registros.length) render();
  } catch (err) {
    document.getElementById('esquemaContenido').innerHTML = `<div class="empty">⚠ ${err.message}</div>`;
  }
}

function parseEscala(texto) {
  return texto.split('\n').map(linea => {
    const m = linea.match(/(\d+)\s*-\s*(\d+)\s*:\s*(\d+)/);
    if (!m) return null;
    return { desde: Number(m[1]), hasta: Number(m[2]), unidades: Number(m[3]) };
  }).filter(Boolean);
}

function unidadesSugeridas(valor) {
  const tramo = escalaCorreccion.find(r => valor >= r.desde && valor <= r.hasta);
  return tramo ? tramo.unidades : null;
}

function renderEsquema() {
  const t = tratamiento;
  const cont = document.getElementById('esquemaContenido');

  if (!t || Object.keys(t).length === 0) {
    cont.innerHTML = '<div class="empty">Todavía no cargaste el esquema. Tocá "Editar" para completarlo.</div>';
    return;
  }

  const filasEscala = escalaCorreccion.map(r =>
    `<tr><td>${r.desde}–${r.hasta} mg/dL</td><td>${r.unidades} U</td></tr>`
  ).join('');

  cont.innerHTML = `
    <div class="esquema-grid">
      <div class="esquema-block">
        <div class="titulo">Basal</div>
        <div class="nombre">${t.BasalNombre || '—'}</div>
        <div class="detalle">${t.BasalHorario || ''}</div>
        <div class="esquema-doses">
          <span>${t.BasalDosis ? t.BasalDosis + ' UI' : '—'}</span>
          ${t.BasalObjetivoAyunas ? `<span>Ayunas: ${t.BasalObjetivoAyunas}</span>` : ''}
        </div>
      </div>
      <div class="esquema-block">
        <div class="titulo">Prandial (corrección)</div>
        <div class="nombre">${t.PrandialNombre || '—'}</div>
        <div class="detalle">${t.PrandialIndicacion || ''}</div>
        ${filasEscala ? `<table class="escala-tabla">${filasEscala}</table>` : ''}
      </div>
      ${t.MedOralNombre ? `
      <div class="esquema-block" style="grid-column:1 / -1;">
        <div class="titulo">Vía oral</div>
        <div class="nombre">${t.MedOralNombre}</div>
        <div class="detalle">${t.MedOralEsquema || ''}</div>
      </div>` : ''}
      ${t.Monitoreo ? `<div class="esquema-monitoreo"><b>Monitoreo:</b> ${t.Monitoreo}</div>` : ''}
      ${t.NotaOmision ? `<div class="esquema-nota">${t.NotaOmision}</div>` : ''}
      ${t.NotaGeneral ? `<div class="esquema-nota">${t.NotaGeneral}</div>` : ''}
      ${t.ActualizadoFecha ? `<div class="esquema-updated">Actualizado: ${t.ActualizadoFecha}</div>` : ''}
    </div>`;
}

const overlayEsquema = document.getElementById('overlayEsquema');

document.getElementById('btnEditarEsquema').addEventListener('click', () => {
  document.getElementById('eBasalNombre').value = tratamiento.BasalNombre || '';
  document.getElementById('eBasalDosis').value = tratamiento.BasalDosis || '';
  document.getElementById('eBasalHorario').value = tratamiento.BasalHorario || '';
  document.getElementById('eBasalObjetivo').value = tratamiento.BasalObjetivoAyunas || '';
  document.getElementById('ePrandialNombre').value = tratamiento.PrandialNombre || '';
  document.getElementById('ePrandialIndicacion').value = tratamiento.PrandialIndicacion || '';
  document.getElementById('eEscalaCorreccion').value = tratamiento.EscalaCorreccion || '';
  document.getElementById('eAlertaBajo').value = tratamiento.AlertaBajo || '';
  document.getElementById('eAlertaAlto').value = tratamiento.AlertaAlto || '';
  document.getElementById('eMedOralNombre').value = tratamiento.MedOralNombre || '';
  document.getElementById('eMedOralEsquema').value = tratamiento.MedOralEsquema || '';
  document.getElementById('eNotaOmision').value = tratamiento.NotaOmision || '';
  document.getElementById('eMonitoreo').value = tratamiento.Monitoreo || '';
  document.getElementById('eNotaGeneral').value = tratamiento.NotaGeneral || '';
  overlayEsquema.classList.add('show');
});
document.getElementById('btnCancelarEsquema').addEventListener('click', () => overlayEsquema.classList.remove('show'));
overlayEsquema.addEventListener('click', (e) => { if (e.target === overlayEsquema) overlayEsquema.classList.remove('show'); });

document.getElementById('btnGuardarEsquema').addEventListener('click', async () => {
  const payload = {
    action: 'saveTratamiento',
    BasalNombre: document.getElementById('eBasalNombre').value,
    BasalDosis: document.getElementById('eBasalDosis').value,
    BasalHorario: document.getElementById('eBasalHorario').value,
    BasalObjetivoAyunas: document.getElementById('eBasalObjetivo').value,
    PrandialNombre: document.getElementById('ePrandialNombre').value,
    PrandialIndicacion: document.getElementById('ePrandialIndicacion').value,
    EscalaCorreccion: document.getElementById('eEscalaCorreccion').value,
    AlertaBajo: document.getElementById('eAlertaBajo').value,
    AlertaAlto: document.getElementById('eAlertaAlto').value,
    MedOralNombre: document.getElementById('eMedOralNombre').value,
    MedOralEsquema: document.getElementById('eMedOralEsquema').value,
    NotaOmision: document.getElementById('eNotaOmision').value,
    Monitoreo: document.getElementById('eMonitoreo').value,
    NotaGeneral: document.getElementById('eNotaGeneral').value
  };
  const btn = document.getElementById('btnGuardarEsquema');
  btn.textContent = 'Guardando…';
  try {
    const res = await jsonpCall(payload);
    if (!res.ok) throw new Error(res.error);
    tratamiento = res.data;
    escalaCorreccion = parseEscala(tratamiento.EscalaCorreccion || '');
    renderEsquema();
    overlayEsquema.classList.remove('show');
    mostrarToast('Esquema actualizado');
    render();
  } catch (err) {
    mostrarToast('Error: ' + err.message);
  }
  btn.textContent = 'Guardar esquema';
});

// ==== RANGO DE FECHAS SEGÚN FILTRO ====
function calcularRango() {
  const hoy = hoyStr();
  switch (rangoActivo) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy };
    case 'mes': return { desde: primerDiaMes(hoy), hasta: hoy };
    case '3m': return { desde: sumarDias(hoy, -89), hasta: hoy };
    case 'custom': {
      const desde = document.getElementById('desde').value || hoy;
      const hasta = document.getElementById('hasta').value || hoy;
      return { desde, hasta };
    }
  }
}

function registrosEnRango() {
  const { desde, hasta } = calcularRango();
  return registros.filter(r => r.fecha >= desde && r.fecha <= hasta);
}

// ==== RENDER PRINCIPAL ====
let vistaActiva = 'lista';

function render() {
  document.getElementById('fechaHoy').textContent =
    'Glucemia e insulina · ' + formatFechaLarga(hoyStr());
  renderUltimos();
  renderLista();
  renderPlanilla();
  renderStats();
  renderAlerta();
  renderChart();
}

document.getElementById('vistaToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#vistaToggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  vistaActiva = btn.dataset.vista;
  document.getElementById('lista').style.display = vistaActiva === 'lista' ? '' : 'none';
  document.getElementById('planillaWrap').style.display = vistaActiva === 'planilla' ? 'block' : 'none';
});

const ORDEN_MOMENTOS = [
  'Antes desayuno', 'Antes almuerzo', 'Después almuerzo', 'Antes cena', 'Después cena', 'Otro'
];

function renderPlanilla() {
  const cont = document.getElementById('planillaWrap');
  const items = registrosEnRango();

  if (items.length === 0) {
    cont.innerHTML = '<div class="empty">No hay registros en este período.</div>';
    return;
  }

  const fechas = [...new Set(items.map(r => r.fecha))].sort().reverse(); // más reciente primero, como en el papel
  const momentos = ORDEN_MOMENTOS.filter(m => items.some(r => (r.momento || 'Otro') === m));

  let html = '<table class="planilla"><thead><tr><th class="momento-label">Momento</th>';
  fechas.forEach(f => { html += `<th>${f.slice(8, 10)}/${f.slice(5, 7)}</th>`; });
  html += '</tr></thead><tbody>';

  momentos.forEach(m => {
    html += `<tr><td class="momento-label">${m}</td>`;
    fechas.forEach(f => {
      const celdas = items.filter(r => r.fecha === f && (r.momento || 'Otro') === m);
      if (celdas.length === 0) { html += '<td></td>'; return; }
      let contenido = '';
      celdas.filter(r => r.tipo === 'Glucemia').forEach(gluc => {
        contenido += `<span class="celda-gluc ${claseValor(Number(gluc.valorGlucemia))}">${gluc.valorGlucemia}</span>`;
      });
      celdas.filter(r => r.tipo === 'GlucemiaSensor').forEach(sensor => {
        contenido += `<span class="celda-sensor">📡 ${sensor.valorGlucemia}</span>`;
      });
      celdas.filter(r => r.tipo === 'Insulina').forEach(ins => {
        contenido += `<span class="celda-ins">${ins.tipoInsulina} ${ins.unidades}U</span>`;
      });
      celdas.filter(r => r.tipo === 'Comida').forEach(com => {
        contenido += `<span class="celda-comida">🍽 ${com.observaciones}</span>`;
      });
      html += `<td>${contenido}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  cont.innerHTML = html;
}

function renderUltimos() {
  const gluc = [...registros].filter(r => r.tipo === 'Glucemia').sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora))[0];
  const ins = [...registros].filter(r => r.tipo === 'Insulina').sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora))[0];

  document.getElementById('ultGluc').textContent = gluc ? `${gluc.valorGlucemia} mg/dL` : '—';
  document.getElementById('ultGlucSub').textContent = gluc ? `${gluc.fecha} · ${gluc.hora}` : 'Sin registros';

  document.getElementById('ultIns').textContent = ins ? `${ins.unidades} U` : '—';
  document.getElementById('ultInsSub').textContent = ins ? `${ins.tipoInsulina} · ${ins.hora}` : 'Sin registros';
}

function claseValor(valor) {
  const alertaBajo = Number(tratamiento.AlertaBajo) || CONFIG.RANGO_BAJO;
  const alertaAlto = Number(tratamiento.AlertaAlto);

  // Rojo: fuera del umbral de aviso a la diabetóloga (configurado en el esquema)
  if (valor < alertaBajo) return 'alerta';
  if (alertaAlto && valor > alertaAlto) return 'alerta';

  // Ámbar: fuera del rango objetivo del día a día, pero no es urgente avisar
  if (valor > CONFIG.RANGO_ALTO) return 'alto';

  return 'ok';
}

function renderLista() {
  const items = registrosEnRango().sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  const cont = document.getElementById('lista');

  if (items.length === 0) {
    cont.innerHTML = '<div class="empty">No hay registros en este período.</div>';
    return;
  }

  cont.innerHTML = items.map(r => {
    if (r.tipo === 'Glucemia') {
      const cls = claseValor(Number(r.valorGlucemia));
      return `
      <div class="item">
        <div class="icon gluc">🩸</div>
        <div class="info">
          <div class="main">${r.momento || 'Glucemia'} <span style="font-weight:400;color:var(--ink-soft);">(capilar)</span></div>
          <div class="sub">${r.fecha} · ${r.hora}${r.observaciones ? ' · ' + r.observaciones : ''}</div>
        </div>
        <div class="value ${cls}">${r.valorGlucemia}</div>
        <button class="del" data-id="${r.id}" title="Eliminar">✕</button>
      </div>`;
    } else if (r.tipo === 'GlucemiaSensor') {
      const cls = claseValor(Number(r.valorGlucemia));
      return `
      <div class="item">
        <div class="icon sensor">📡</div>
        <div class="info">
          <div class="main">${r.momento || ''} <span style="font-weight:400;color:var(--ink-soft);">(sensor FreeStyle)</span></div>
          <div class="sub">${r.fecha} · ${r.hora}${r.observaciones ? ' · ' + r.observaciones : ''}</div>
        </div>
        <div class="value ${cls}">${r.valorGlucemia}</div>
        <button class="del" data-id="${r.id}" title="Eliminar">✕</button>
      </div>`;
    } else if (r.tipo === 'Comida') {
      return `
      <div class="item">
        <div class="icon comida">🍽</div>
        <div class="info">
          <div class="main">${r.observaciones || 'Comida'}</div>
          <div class="sub">${r.fecha} · ${r.hora} · ${r.momento || ''}</div>
        </div>
        <button class="del" data-id="${r.id}" title="Eliminar">✕</button>
      </div>`;
    } else {
      return `
      <div class="item">
        <div class="icon ins">💉</div>
        <div class="info">
          <div class="main">${r.tipoInsulina} · ${r.momento || ''}</div>
          <div class="sub">${r.fecha} · ${r.hora}${r.observaciones ? ' · ' + r.observaciones : ''}</div>
        </div>
        <div class="value">${r.unidades} U</div>
        <button class="del" data-id="${r.id}" title="Eliminar">✕</button>
      </div>`;
    }
  }).join('');

  cont.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => eliminarRegistro(btn.dataset.id));
  });
}

function renderAlerta() {
  const cont = document.getElementById('alertaBanner');
  const bajo = Number(tratamiento.AlertaBajo);
  const alto = Number(tratamiento.AlertaAlto);
  if (!bajo && !alto) { cont.innerHTML = ''; return; }

  const items = registrosEnRango().filter(r => r.tipo === 'Glucemia');
  const fueraDeRango = items.filter(r => {
    const v = Number(r.valorGlucemia);
    return (bajo && v < bajo) || (alto && v > alto);
  });

  if (fueraDeRango.length === 0) { cont.innerHTML = ''; return; }

  const detalle = fueraDeRango
    .map(r => `${r.fecha} ${r.hora}: ${r.valorGlucemia} mg/dL`)
    .join(' · ');

  cont.innerHTML = `<div class="alerta-banner">⚠ Valores fuera del rango de aviso (menos de ${bajo || '—'} o más de ${alto || '—'} mg/dL) — avisar a la diabetóloga.<br>${detalle}</div>`;
}

function renderStats() {
  const items = registrosEnRango();
  const glucemias = items.filter(r => r.tipo === 'Glucemia').map(r => Number(r.valorGlucemia));
  const insulinas = items.filter(r => r.tipo === 'Insulina').map(r => Number(r.unidades));

  document.getElementById('statProm').textContent = glucemias.length
    ? Math.round(glucemias.reduce((a, b) => a + b, 0) / glucemias.length) + ' mg/dL'
    : '—';

  document.getElementById('statRango').textContent = glucemias.length
    ? `${Math.min(...glucemias)} / ${Math.max(...glucemias)}`
    : '—';

  document.getElementById('statIns').textContent = insulinas.length
    ? insulinas.reduce((a, b) => a + b, 0) + ' U'
    : '—';
}

function renderChart() {
  const capilar = registrosEnRango().filter(r => r.tipo === 'Glucemia');
  const sensor = registrosEnRango().filter(r => r.tipo === 'GlucemiaSensor');

  // Timeline combinada (capilar + sensor), ordenada cronológicamente
  const timeline = [...new Set([...capilar, ...sensor].map(r => r.fecha + ' ' + r.hora))].sort();

  const labels = timeline.map(t => {
    const [f, h] = t.split(' ');
    return rangoActivo === 'hoy' ? h : `${f.slice(5)} ${h}`;
  });

  const buscar = (lista, t) => {
    const [f, h] = t.split(' ');
    const r = lista.find(x => x.fecha === f && x.hora === h);
    return r ? Number(r.valorGlucemia) : null;
  };
  const dataCapilar = timeline.map(t => buscar(capilar, t));
  const dataSensor = timeline.map(t => buscar(sensor, t));

  const ctx = document.getElementById('chart').getContext('2d');
  if (chart) chart.destroy();

  const datasets = [{
    label: 'Capilar',
    data: dataCapilar,
    borderColor: '#155E63',
    backgroundColor: 'rgba(21,94,99,0.08)',
    pointBackgroundColor: dataCapilar.map(v => v === null ? 'transparent' : claseValor(v) === 'alerta' ? '#C4453E' : claseValor(v) === 'alto' ? '#D98C2B' : '#155E63'),
    pointRadius: 4,
    tension: 0.25,
    fill: true,
    borderWidth: 2,
    spanGaps: true
  }];

  if (dataSensor.some(v => v !== null)) {
    datasets.push({
      label: 'Sensor (FreeStyle)',
      data: dataSensor,
      borderColor: '#6A4C93',
      backgroundColor: 'transparent',
      pointBackgroundColor: '#6A4C93',
      pointRadius: 3,
      tension: 0.25,
      fill: false,
      borderWidth: 2,
      borderDash: [5, 4],
      spanGaps: true
    });
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { display: datasets.length > 1, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: { suggestedMin: 40, suggestedMax: 260, grid: { color: '#EDF3F3' } },
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } }
      }
    }
  });
}

// ==== FILTROS ====
document.getElementById('filtros').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  rangoActivo = btn.dataset.range;
  document.getElementById('rangeCustom').classList.toggle('show', rangoActivo === 'custom');
  if (rangoActivo === 'custom') {
    if (!document.getElementById('desde').value) document.getElementById('desde').value = sumarDias(hoyStr(), -6);
    if (!document.getElementById('hasta').value) document.getElementById('hasta').value = hoyStr();
  }
  render();
});
document.getElementById('desde').addEventListener('change', render);
document.getElementById('hasta').addEventListener('change', render);

// ==== FORMULARIO NUEVO REGISTRO (unificado: glucemia + una o más insulinas) ====
const overlay = document.getElementById('overlay');

function filaInsulinaHTML() {
  return `
    <div class="insulina-row">
      <select class="ins-tipo">
        <option>Toujeo</option>
        <option>Corriente</option>
      </select>
      <input type="number" class="ins-unidades" placeholder="Unidades" inputmode="numeric">
      <button type="button" class="quitar" title="Quitar">✕</button>
    </div>`;
}

function agregarFilaInsulina() {
  const cont = document.getElementById('insulinaRows');
  cont.insertAdjacentHTML('beforeend', filaInsulinaHTML());
  const fila = cont.lastElementChild;
  fila.querySelector('.quitar').addEventListener('click', () => {
    // Siempre dejar al menos una fila visible
    if (cont.children.length > 1) fila.remove();
    else { fila.querySelector('.ins-unidades').value = ''; }
  });
}

document.getElementById('btnAgregarInsulina').addEventListener('click', agregarFilaInsulina);

document.getElementById('btnNuevo').addEventListener('click', () => {
  document.getElementById('fFecha').value = hoyStr();
  document.getElementById('fHora').value = new Date().toTimeString().slice(0, 5);
  document.getElementById('fValor').value = '';
  document.getElementById('fValorSensor').value = '';
  document.getElementById('fComida').value = '';
  document.getElementById('fObs').value = '';
  document.getElementById('hintCorreccion').textContent = '';
  document.getElementById('insulinaRows').innerHTML = '';
  agregarFilaInsulina();
  overlay.classList.add('show');
});
document.getElementById('btnCancelar').addEventListener('click', () => overlay.classList.remove('show'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('show'); });

document.getElementById('fValor').addEventListener('input', (e) => {
  const valor = Number(e.target.value);
  const hint = document.getElementById('hintCorreccion');
  if (!valor) { hint.textContent = ''; return; }

  const bajo = Number(tratamiento.AlertaBajo);
  const alto = Number(tratamiento.AlertaAlto);
  if (bajo && valor < bajo) {
    hint.innerHTML = `⚠ Por debajo de ${bajo} mg/dL — avisar a la diabetóloga.`;
    hint.style.color = 'var(--red)';
    return;
  }
  if (alto && valor > alto) {
    hint.innerHTML = `⚠ Por encima de ${alto} mg/dL — avisar a la diabetóloga.`;
    hint.style.color = 'var(--red)';
    return;
  }
  const sugerido = unidadesSugeridas(valor);
  hint.style.color = 'var(--ink-soft)';
  hint.textContent = sugerido !== null
    ? `Corrección sugerida (Novorapid): ${sugerido} U — según escala indicada`
    : '';
});

document.getElementById('btnGuardar').addEventListener('click', async () => {
  const fecha = document.getElementById('fFecha').value;
  const hora = document.getElementById('fHora').value;
  const momento = document.getElementById('fMomento').value;
  const observaciones = document.getElementById('fObs').value;
  if (!fecha || !hora) { mostrarToast('Falta fecha u hora'); return; }

  const valor = document.getElementById('fValor').value;
  const valorSensor = document.getElementById('fValorSensor').value;
  const comida = document.getElementById('fComida').value;
  const filasInsulina = [...document.querySelectorAll('#insulinaRows .insulina-row')]
    .map(fila => ({
      tipoInsulina: fila.querySelector('.ins-tipo').value,
      unidades: fila.querySelector('.ins-unidades').value
    }))
    .filter(f => f.unidades !== '');

  if (!valor && !valorSensor && !comida && filasInsulina.length === 0) {
    mostrarToast('Cargá al menos un dato para guardar');
    return;
  }

  const btn = document.getElementById('btnGuardar');
  btn.textContent = 'Guardando…';
  try {
    const llamadas = [];
    if (valor) {
      llamadas.push({ tipo: 'Glucemia', promise: jsonpCall({
        action: 'addRegistro', fecha, hora, momento, observaciones,
        tipo: 'Glucemia', valorGlucemia: valor
      })});
    }
    if (valorSensor) {
      llamadas.push({ tipo: 'Sensor', promise: jsonpCall({
        action: 'addRegistro', fecha, hora, momento, observaciones,
        tipo: 'GlucemiaSensor', valorGlucemia: valorSensor
      })});
    }
    filasInsulina.forEach(f => {
      llamadas.push({ tipo: `Insulina (${f.tipoInsulina})`, promise: jsonpCall({
        action: 'addRegistro', fecha, hora, momento, observaciones,
        tipo: 'Insulina', tipoInsulina: f.tipoInsulina, unidades: f.unidades
      })});
    });
    if (comida) {
      llamadas.push({ tipo: 'Comida', promise: jsonpCall({
        action: 'addRegistro', fecha, hora, momento,
        tipo: 'Comida', observaciones: comida
      })});
    }

    if (llamadas.length === 0) {
      mostrarToast('No hay nada para guardar');
      btn.textContent = 'Guardar registro';
      return;
    }

    const resultados = await Promise.all(llamadas.map(l => l.promise));
    const falloIdx = resultados.findIndex(r => !r.ok);
    if (falloIdx !== -1) throw new Error(`${llamadas[falloIdx].tipo}: ${resultados[falloIdx].error}`);

    overlay.classList.remove('show');
    mostrarToast('Registro guardado');
    await cargarRegistros();
  } catch (err) {
    mostrarToast('Error: ' + err.message);
  }
  btn.textContent = 'Guardar registro';
});

async function eliminarRegistro(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    const res = await jsonpCall({ action: 'deleteRegistro', id });
    if (!res.ok) throw new Error(res.error);
    mostrarToast('Registro eliminado');
    await cargarRegistros();
  } catch (err) {
    mostrarToast('Error: ' + err.message);
  }
}

function mostrarToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ==== EXPORTACIÓN ====
document.getElementById('btnPdf').addEventListener('click', exportarPDF);
document.getElementById('btnXls').addEventListener('click', exportarExcel);

function tituloRango() {
  const nombres = { hoy: 'Hoy', '7d': 'Últimos 7 días', mes: 'Este mes', '3m': 'Últimos 3 meses', custom: 'Rango personalizado' };
  const { desde, hasta } = calcularRango();
  return `${nombres[rangoActivo]} (${desde} a ${hasta})`;
}

function exportarPDF() {
  const items = registrosEnRango().sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  if (items.length === 0) { mostrarToast('No hay datos para exportar'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('Control de Glucemia e Insulina', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(tituloRango(), 14, 25);

  const glucemias = items.filter(r => r.tipo === 'Glucemia').map(r => Number(r.valorGlucemia));
  const insulinas = items.filter(r => r.tipo === 'Insulina').map(r => Number(r.unidades));
  const resumen = glucemias.length
    ? `Promedio: ${Math.round(glucemias.reduce((a, b) => a + b, 0) / glucemias.length)} mg/dL   ·   Mín/Máx: ${Math.min(...glucemias)}/${Math.max(...glucemias)} mg/dL   ·   Insulina total: ${insulinas.reduce((a, b) => a + b, 0)} U`
    : '';
  if (resumen) { doc.text(resumen, 14, 31); }

  const rows = items.map(r => {
    if (r.tipo === 'Glucemia') return [r.fecha, r.hora, 'Glucemia (capilar)', `${r.valorGlucemia} mg/dL`, r.momento || '', r.observaciones || ''];
    if (r.tipo === 'GlucemiaSensor') return [r.fecha, r.hora, 'Glucemia (sensor)', `${r.valorGlucemia} mg/dL`, r.momento || '', r.observaciones || ''];
    if (r.tipo === 'Comida') return [r.fecha, r.hora, 'Comida', r.observaciones || '', r.momento || '', ''];
    return [r.fecha, r.hora, 'Insulina', `${r.tipoInsulina} · ${r.unidades} U`, r.momento || '', r.observaciones || ''];
  });

  doc.autoTable({
    startY: 37,
    head: [['Fecha', 'Hora', 'Tipo', 'Valor', 'Momento', 'Observaciones']],
    body: rows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [21, 94, 99] }
  });

  doc.save(`glucemia_${calcularRango().desde}_a_${calcularRango().hasta}.pdf`);
}

function exportarExcel() {
  const items = registrosEnRango().sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  if (items.length === 0) { mostrarToast('No hay datos para exportar'); return; }

  const rows = items.map(r => ({
    Fecha: r.fecha,
    Hora: r.hora,
    Tipo: r.tipo,
    'Glucemia capilar (mg/dL)': r.tipo === 'Glucemia' ? r.valorGlucemia : '',
    'Glucemia sensor (mg/dL)': r.tipo === 'GlucemiaSensor' ? r.valorGlucemia : '',
    'Tipo Insulina': r.tipo === 'Insulina' ? r.tipoInsulina : '',
    Unidades: r.tipo === 'Insulina' ? r.unidades : '',
    Comida: r.tipo === 'Comida' ? r.observaciones : '',
    Momento: r.momento || '',
    Observaciones: r.tipo !== 'Comida' ? (r.observaciones || '') : ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  XLSX.writeFile(wb, `glucemia_${calcularRango().desde}_a_${calcularRango().hasta}.xlsx`);
}

// ==== PWA: registrar service worker ====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ==== INIT ====
cargarRegistros();
cargarTratamiento();
