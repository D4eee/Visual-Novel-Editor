/**
 * Collectibles (Game module).
 *
 * Items are defined once per project (name + icon). The player's inventory is a list
 * variable holding item names (duplicates count: two "Coin" entries = two coins), so
 * every list block and expression works on it: has("Key"), count(inventory, "Coin").
 */
import type { ItemDef, Project, VariableDef } from './types';
import { newId } from './util';

/** Find an item by id or (case-insensitive) name. */
export function findItem(project: Project, key: unknown): ItemDef | undefined {
  if (key === null || key === undefined || key === '') return undefined;
  const k = String(key);
  return project.items.find((i) => i.id === k) || project.items.find((i) => i.name.toLowerCase() === k.toLowerCase());
}

/** The inventory variable, created (as the list variable "inventory") when missing. */
export function ensureInventoryVar(project: Project, name = 'inventory'): VariableDef {
  const cur = project.inventoryVarId ? project.variables.find((v) => v.id === project.inventoryVarId) : undefined;
  if (cur) return cur;
  let n = name, i = 2;
  while (project.variables.some((v) => v.name === n)) n = `${name}${i++}`;
  const v: VariableDef = { id: newId('var'), name: n, type: 'list', initial: [], scope: 'game', description: '' };
  project.variables.push(v);
  project.inventoryVarId = v.id;
  return v;
}

export function createItem(project: Project, name: string, assetId: string | null = null): ItemDef {
  let n = name.trim() || 'Item', i = 2;
  const base = n;
  while (project.items.some((x) => x.name.toLowerCase() === n.toLowerCase())) n = `${base} ${i++}`;
  const item: ItemDef = { id: newId('itm'), name: n, assetId, description: '' };
  project.items.push(item);
  ensureInventoryVar(project);
  return item;
}
