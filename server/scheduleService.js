'use strict';

// Service: siapkan jadwal terhitung (hasil CPM) + sumber daya + peringatan dari database.
// Dipakai bersama oleh Gantt, PERT, analisis jalur kritis, dan resource chart.

const { db } = require('./db');
const { computeSchedule } = require('./scheduler/cpm');
const { analyzeResources } = require('./scheduler/resources');
const { rangeInclusive, workdaySet } = require('./scheduler/calendar');

function loadRows(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const holidays = db.prepare('SELECT id, date, name FROM holidays WHERE project_id = ? ORDER BY date').all(projectId);
  const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort, id').all(projectId);
  const taskIds = tasks.map((t) => t.id);
  const inClause = taskIds.length ? '(' + taskIds.join(',') + ')' : '(0)';
  const deps = db.prepare('SELECT * FROM deps WHERE task_id IN ' + inClause).all();
  const assignments = db.prepare('SELECT * FROM assignments WHERE task_id IN ' + inClause).all();
  const members = db.prepare('SELECT id, name, phone, email, role, salary_per_day FROM members ORDER BY name').all();
  const leaves = db.prepare('SELECT * FROM member_leaves').all();
  return { project, holidays, tasks, deps, assignments, members, leaves };
}

function isProjectWorkday(ymd, project, holidaySet) {
  const flags = workdaySet(String(project.workdays).split('').map(Number));
  if (!flags.has(new Date(ymd + 'T00:00:00Z').getUTCDay())) return false;
  return !holidaySet.has(ymd);
}

function buildSchedule(projectId) {
  const data = loadRows(projectId);
  if (!data) return null;
  const { project, holidays, tasks, deps, assignments, members, leaves } = data;

  const schedule = computeSchedule({
    project: {
      start_date: project.start_date,
      workdays: project.workdays,
    },
    holidays: holidays.map((h) => h.date),
    tasks: tasks.map((t) => ({
      id: t.id, parent_id: t.parent_id, code: t.code, name: t.name,
      start_date: t.start_date, duration: t.duration, priority: t.priority,
      notes: t.notes, responsible_id: t.responsible_id, progress: t.progress,
    })),
    deps: deps.map((d) => ({ task_id: d.task_id, pred_id: d.pred_id, type: d.type, lag: d.lag })),
    assignments: assignments.map((a) => ({ task_id: a.task_id, member_id: a.member_id, allocation: a.allocation })),
    leaves: leaves.map((l) => ({ member_id: l.member_id, start_date: l.start_date, end_date: l.end_date })),
  });

  const memberById = new Map(members.map((m) => [m.id, m]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const holidaySet = new Map(holidays.map((h) => [h.date, h.name]));
  const flags = workdaySet(String(project.workdays).split('').map(Number));

  // Perayaan tanggal & detail penugasan
  for (const row of schedule.tasks) {
    const orig = taskById.get(row.id) || {};
    row.name = orig.name;
    const resp = memberById.get(orig.responsible_id);
    row.responsible_name = resp ? resp.name : '';
    row.assignees = (row.assignees || []).map((a) => {
      const m = memberById.get(a.member_id) || {};
      return {
        member_id: a.member_id,
        allocation: a.allocation,
        name: m.name || '#' + a.member_id,
        role: m.role || '',
        salary_per_day: m.salary_per_day || 0,
      };
    });
    // Teks predecessor "2.3FS+7, 3.1SS+2"
    row.deps_text = (row.deps || [])
      .map((d) => d.pred_code + d.type + (d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''))
      .join(', ');
  }

  // Peringatan: tugas berhenti karena cuti anggota
  const leaveConflicts = [];
  for (const row of schedule.tasks) {
    if (!row.is_leaf || !row.start || !row.finish) continue;
    for (const a of row.assignees) {
      for (const l of leaves.filter((x) => x.member_id === a.member_id)) {
        const end = l.end_date || l.start_date;
        for (const d of rangeInclusive(l.start_date, end)) {
          if (d >= row.start && d <= row.finish && holidaySet.has(d) === false && flags.has(new Date(d + 'T00:00:00Z').getUTCDay())) {
            leaveConflicts.push({
              member_id: a.member_id,
              member: memberById.get(a.member_id) ? memberById.get(a.member_id).name : '#' + a.member_id,
              task_id: row.id, task_code: row.code, task_name: row.name,
              date: d, notes: l.notes || 'Cuti',
            });
            break;
          }
        }
      }
    }
  }
  leaveConflicts.sort((x, y) => (x.date < y.date ? -1 : 1));

  const resources = analyzeResources(schedule, members, leaves, {});

  // konversi jalur kritis dari id tugas menjadi kode WBS untuk tampilan
  const codeOf = new Map(tasks.map((t) => [t.id, t.code]));
  const chainsAsCodes = schedule.criticalChains.map((chain) => chain.map((id) => codeOf.get(id) || '?'));

  return {
    project: {
      id: project.id, name: project.name, org: project.org,
      description: project.description, start_date: project.start_date,
      workdays: String(project.workdays).split('').map(Number),
    },
    holidays: holidays,
    members: members,
    tasks: schedule.tasks,
    projectStart: schedule.projectStart,
    projectFinish: schedule.projectFinish,
    projectDuration: schedule.projectDuration,
    criticalChains: chainsAsCodes,
    calendarWorkdays: schedule.calendar.workdays,
    warnings: {
      overallocations: resources.overallocations,
      leaveConflicts: leaveConflicts.slice(0, 80),
    },
    resources,
  };
}

// Simulasi keterlambatan: tidak mengubah data, hanya menghitung ulang.
function simulate(projectId, taskId, delayDays) {
  const data = loadRows(projectId);
  if (!data) return null;
  if (!data.tasks.some((t) => t.id === taskId)) return null;
  const base = computeSchedule(projectInput(data));
  const sim = computeSchedule(projectInput(data), { delays: { [taskId]: Math.max(0, Number(delayDays) || 0) } });
  const finishOf = (s) => s.projectFinish;
  const b = finishOf(base), s2 = finishOf(sim);
  const dayDiff = Math.round((new Date(s2 + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
  const task = sim.tasks.find((t) => t.id === taskId && t.is_leaf);
  const taskBase = base.tasks.find((t) => t.id === taskId && t.is_leaf);
  const byIdAll = new Map(data.tasks.map((t) => [t.id, t]));
  return {
    task: {
      id: taskId,
      code: byIdAll.get(taskId).code,
      name: byIdAll.get(taskId).name,
      mulai_lama: taskBase ? taskBase.start : null,
      selesai_lama: taskBase ? taskBase.finish : null,
      mulai_baru: task ? task.start : null,
      selesai_baru: task ? task.finish : null,
    },
    delay_days: Math.max(0, Number(delayDays) || 0),
    selesai_proyek_lama: b,
    selesai_proyek_baru: s2,
    bergeser_hari: dayDiff,
    mempengaruhi_selesai: dayDiff > 0,
    criticalChains: sim.criticalChains,
    tasks: sim.tasks, // untuk detail penuh bila diperlukan
  };
}

function projectInput(data) {
  return {
    project: { start_date: data.project.start_date, workdays: data.project.workdays },
    holidays: data.holidays.map((h) => h.date),
    tasks: data.tasks.map((t) => ({
      id: t.id, parent_id: t.parent_id, code: t.code, name: t.name,
      start_date: t.start_date, duration: t.duration, priority: t.priority,
      notes: t.notes, responsible_id: t.responsible_id, progress: t.progress,
    })),
    deps: data.deps.map((d) => ({ task_id: d.task_id, pred_id: d.pred_id, type: d.type, lag: d.lag })),
    assignments: data.assignments.map((a) => ({ task_id: a.task_id, member_id: a.member_id, allocation: a.allocation })),
    leaves: data.leaves.map((l) => ({ member_id: l.member_id, start_date: l.start_date, end_date: l.end_date })),
  };
}

function buildScheduleSafe(projectId) {
  try {
    return buildSchedule(projectId);
  } catch (e) {
    return { error: true, message: e.message };
  }
}

module.exports = { buildSchedule, buildScheduleSafe, simulate };
