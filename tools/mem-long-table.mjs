// node tools/mem-long-table.mjs <log> [...logs] — one line per sample of a tools/mem-long-probe.mjs log
import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => / t=\d+ \{/.test(l));
  console.log(`== ${file}: ${rows.length} samples`);
  console.log('   t state     beat        rend  gpu  total heap/total  geo tex  objs gpuInfo audioNodes(live) stream');
  for (const l of rows) {
    const t = l.match(/ t=(\d+) /)[1];
    const start = l.indexOf('{');
    const end = l.includes(' grew/shrank: ') ? l.indexOf(' grew/shrank: ') : l.length;
    const j = JSON.parse(l.slice(start, end).trim());
    const st = j.stream ? `${j.stream.resident}/${j.stream.cells} +${j.stream.adds} -${j.stream.drops}` : '';
    console.log([t.padStart(4), j.state.padEnd(9), String(j.beat).padEnd(10), String(j.rend).padStart(5), String(j.gpu).padStart(4), String(j.total).padStart(5),
      `${j.heapMB}/${j.heapTotalMB}`.padStart(9), String(j.geo).padStart(5), String(j.tex).padStart(3), String(j.objects).padStart(5),
      String(j.gpuInfoMB ?? '').padStart(7), `${j.audio.nodes}(${j.audio.live})`.padStart(11), st].join(' '));
  }
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) if (/PEAK|DRIFT/.test(l)) console.log(l);
}
