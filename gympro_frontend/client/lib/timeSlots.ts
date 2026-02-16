import { todayYMDIST } from './timezone';

// Generate slots in minutes from start of day (IST) and provide helpers.
export interface TimeSlot { value: string; // HH:MM:SS
  label: string; // 12h label
  minutes: number; }

const PAD = (n:number)=> String(n).padStart(2,'0');

export function minutesToHHMMSS(m:number){ const h=Math.floor(m/60); const mm=m%60; return `${PAD(h)}:${PAD(mm)}:00`; }
export function hhmmToMinutes(t:string){ const [h,m] = t.split(':').map(Number); return h*60 + (m||0); }
export function hhmmssToMinutes(t:string){ const parts = t.split(':').map(Number); return parts[0]*60 + (parts[1]||0); }

export function format12h(minutes:number){
  let h = Math.floor(minutes/60); const m = minutes%60; const ampm = h>=12? 'PM':'AM'; let dispH = h%12; if (dispH===0) dispH=12; return `${dispH}:${PAD(m)} ${ampm}`; }

export function generateSlots(step=15, start='08:00', end='21:00'): TimeSlot[] {
  const startM = hhmmToMinutes(start); const endM = hhmmToMinutes(end); const out:TimeSlot[]=[];
  for(let m=startM; m<=endM; m+=step){ out.push({ value: minutesToHHMMSS(m), label: format12h(m), minutes: m }); }
  return out; }

export function nowISTMinutes(): number { const d = new Date(); return d.getHours()*60 + d.getMinutes(); }

export function filterPastSlots(slots:TimeSlot[], dateYMD:string): TimeSlot[] {
  if (dateYMD !== todayYMDIST()) return slots; const nowM = nowISTMinutes(); return slots.filter(s=> s.minutes >= nowM); }

export function buildToSlots(fromSlot:TimeSlot|undefined, slots:TimeSlot[], minStep=15): TimeSlot[] {
  if(!fromSlot) return []; return slots.filter(s=> s.minutes > fromSlot.minutes); }

export interface ExistingInterval { from: string; to: string; staff_id?: any; }
export function conflictsForStaff(slots:TimeSlot[], intervals:ExistingInterval[], staffId:any): Set<string> {
  const blocked = new Set<string>(); const relevant = intervals.filter(i=> staffId && String(i.staff_id)===String(staffId));
  if(!relevant.length) return blocked;
  relevant.forEach(i=>{
    if(!i.from || !i.to) return; const f = hhmmssToMinutes(i.from); const t = hhmmssToMinutes(i.to);
    slots.forEach(s=>{ if (s.minutes >= f && s.minutes < t) blocked.add(s.value); });
  });
  return blocked; }

export function deriveOverlap(fromVal:string, toVal:string, intervals:ExistingInterval[], staffId:any): string | null {
  if(!fromVal || !toVal || !staffId) return null; const f = hhmmssToMinutes(fromVal); const t = hhmmssToMinutes(toVal); if (t<=f) return 'End time must be after start time';
  for(const i of intervals){ if(!i.from || !i.to) continue; if(staffId && String(i.staff_id)!==String(staffId)) continue; const ifm = hhmmssToMinutes(i.from); const itm = hhmmssToMinutes(i.to); if (f < itm && t > ifm) return 'Selected time overlaps with an existing appointment'; }
  return null; }
