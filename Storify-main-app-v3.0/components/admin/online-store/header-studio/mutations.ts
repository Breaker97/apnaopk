import {
  MAX_HEADER_ITEMS_PER_COLUMN,
  MAX_HEADER_ROWS,
  createHeaderColumn,
  createHeaderRow,
  type HeaderLayout,
  type HeaderLayoutColumn,
  type HeaderLayoutItem,
  type HeaderLayoutRow,
} from "@/lib/site-config/header-layout";

/**
 * Every edit the studio can make to the layout tree, as pure functions.
 *
 * The tree is three levels deep, so an inline `setState` per control would
 * mean the same nested map written a dozen times over — and each copy is a
 * chance to drop a sibling. These are also what the tests exercise.
 */

function mapRows(
  layout: HeaderLayout,
  fn: (row: HeaderLayoutRow) => HeaderLayoutRow,
): HeaderLayout {
  return { ...layout, rows: layout.rows.map(fn) };
}

function mapColumns(
  layout: HeaderLayout,
  fn: (column: HeaderLayoutColumn, row: HeaderLayoutRow) => HeaderLayoutColumn,
): HeaderLayout {
  return mapRows(layout, (row) => ({
    ...row,
    columns: row.columns.map((column) => fn(column, row)),
  }));
}

export function patchRow(
  layout: HeaderLayout,
  rowId: string,
  patch: Partial<HeaderLayoutRow>,
): HeaderLayout {
  return mapRows(layout, (row) => {
    if (row.id !== rowId) return row;
    const next = { ...row, ...patch };
    // Growing the column count has to grow the column list with it, or the
    // row renders fewer tracks than it claims.
    const columns = [...next.columns];
    while (columns.length < next.columnCount) columns.push(createHeaderColumn());
    return { ...next, columns };
  });
}

export function patchColumn(
  layout: HeaderLayout,
  columnId: string,
  patch: Partial<HeaderLayoutColumn>,
): HeaderLayout {
  return mapColumns(layout, (column) =>
    column.id === columnId ? { ...column, ...patch } : column,
  );
}

export function patchItem(
  layout: HeaderLayout,
  itemId: string,
  patch: Partial<HeaderLayoutItem>,
): HeaderLayout {
  return mapColumns(layout, (column) => ({
    ...column,
    items: column.items.map((item) =>
      item.id === itemId
        ? // The cast is the union's price: `patch` is a partial of one
          // variant, and only the caller (a typed panel) knows which.
          ({ ...item, ...patch } as HeaderLayoutItem)
        : item,
    ),
  }));
}

export function addRow(layout: HeaderLayout): HeaderLayout {
  if (layout.rows.length >= MAX_HEADER_ROWS) return layout;
  return { ...layout, rows: [...layout.rows, createHeaderRow(3)] };
}

export function removeRow(layout: HeaderLayout, rowId: string): HeaderLayout {
  return { ...layout, rows: layout.rows.filter((row) => row.id !== rowId) };
}

export function moveRow(
  layout: HeaderLayout,
  activeId: string,
  overId: string,
): HeaderLayout {
  const from = layout.rows.findIndex((row) => row.id === activeId);
  const to = layout.rows.findIndex((row) => row.id === overId);
  if (from < 0 || to < 0 || from === to) return layout;
  const rows = [...layout.rows];
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return { ...layout, rows };
}

export function insertItem(
  layout: HeaderLayout,
  columnId: string,
  item: HeaderLayoutItem,
  index?: number,
): HeaderLayout {
  return mapColumns(layout, (column) => {
    if (column.id !== columnId) return column;
    if (column.items.length >= MAX_HEADER_ITEMS_PER_COLUMN) return column;
    const items = [...column.items];
    items.splice(index ?? items.length, 0, item);
    return { ...column, items };
  });
}

export function removeItem(
  layout: HeaderLayout,
  itemId: string,
): HeaderLayout {
  return mapColumns(layout, (column) => ({
    ...column,
    items: column.items.filter((item) => item.id !== itemId),
  }));
}

/**
 * Move a placed item to `toColumnId` at `index`. Moving inside one column is
 * a reorder; moving across columns respects the target's item cap, and a
 * refused move leaves the tree untouched rather than losing the item.
 */
export function moveItem(
  layout: HeaderLayout,
  itemId: string,
  toColumnId: string,
  index?: number,
): HeaderLayout {
  let moved: HeaderLayoutItem | undefined;
  let fromColumnId = "";

  // for-of rather than forEach so the narrowing below survives: TypeScript
  // does not track assignments made inside a callback.
  for (const row of layout.rows) {
    for (const column of row.columns) {
      const found = column.items.find((entry) => entry.id === itemId);
      if (found) {
        moved = found;
        fromColumnId = column.id;
      }
    }
  }

  if (!moved) return layout;
  const item = moved;

  if (fromColumnId === toColumnId) {
    return mapColumns(layout, (column) => {
      if (column.id !== toColumnId) return column;
      const items = column.items.filter((entry) => entry.id !== itemId);
      items.splice(index ?? items.length, 0, item);
      return { ...column, items };
    });
  }

  const target = layout.rows
    .flatMap((row) => row.columns)
    .find((column) => column.id === toColumnId);
  if (!target || target.items.length >= MAX_HEADER_ITEMS_PER_COLUMN) {
    return layout;
  }

  return mapColumns(layout, (column) => {
    if (column.id === fromColumnId) {
      return {
        ...column,
        items: column.items.filter((entry) => entry.id !== itemId),
      };
    }
    if (column.id === toColumnId) {
      const items = [...column.items];
      items.splice(index ?? items.length, 0, item);
      return { ...column, items };
    }
    return column;
  });
}

export function findColumn(
  layout: HeaderLayout,
  columnId: string,
): HeaderLayoutColumn | null {
  return (
    layout.rows
      .flatMap((row) => row.columns)
      .find((column) => column.id === columnId) ?? null
  );
}
