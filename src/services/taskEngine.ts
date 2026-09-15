import { TaskObject, TaskStatus, ActionPermission } from '../types';

const TASKS_STORAGE_KEY = 'dc_intelligence_tasks';

/**
 * Load all tasks from LocalStorage
 */
export function getTasksFromStorage(): TaskObject[] {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Could not load tasks from localStorage', e);
  }
  return [];
}

/**
 * Persist task array to LocalStorage
 */
export function saveTasksToStorage(tasks: TaskObject[]): void {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.warn('Could not save tasks to localStorage', e);
  }
}

/**
 * Create a new task in the Task Engine
 */
export function createTask(params: {
  agentId: string;
  userId?: string;
  companyId?: string;
  action: ActionPermission;
  input: string;
  status?: TaskStatus;
}): TaskObject {
  const newTask: TaskObject = {
    taskId: `TSK-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    agentId: params.agentId,
    userId: params.userId || 'usr-default',
    companyId: params.companyId || 'comp-ivoire-1',
    action: params.action,
    input: params.input,
    status: params.status || 'RUNNING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const tasks = getTasksFromStorage();
  const updated = [newTask, ...tasks];
  saveTasksToStorage(updated);

  return newTask;
}

/**
 * Update status & result of an existing task
 */
export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  result?: any,
  error?: string
): TaskObject | null {
  const tasks = getTasksFromStorage();
  const index = tasks.findIndex((t) => t.taskId === taskId);
  if (index === -1) return null;

  const updatedTask: TaskObject = {
    ...tasks[index],
    status,
    result: result !== undefined ? result : tasks[index].result,
    error: error !== undefined ? error : tasks[index].error,
    updatedAt: new Date().toISOString(),
  };

  tasks[index] = updatedTask;
  saveTasksToStorage(tasks);

  return updatedTask;
}
