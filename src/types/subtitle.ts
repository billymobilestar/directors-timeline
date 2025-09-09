const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
export const fmtSrtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(ss)},${String(ms).padStart(3, '0')}`;
};
export const fmtLrcTime = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor(((s - Math.floor(s)) * 100));
  return `[${pad2(m)}:${pad2(ss)}.${String(cs).padStart(2, '0')}]`;
};