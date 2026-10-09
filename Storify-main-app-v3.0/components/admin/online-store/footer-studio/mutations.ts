import {
  MAX_FOOTER_COLUMNS,
  MAX_FOOTER_ITEMS_PER_COLUMN,
  MAX_FOOTER_ROWS,
  createFooterColumn,
  createFooterRow,
  type FooterLayout,
  type FooterLayoutColumn,
  type FooterLayoutItem,
  type FooterLayoutRow,
} from "@/lib/site-config/footer-layout";

/**
 * Every edit the studio can make to the layout tree, as pure functions.
 *
 * The tree is three levels deep, so an inline `setState` per control would
 * mean the same nested map written a dozen times over — and each copy is a
 * chance to drop a sibling. These are also what the tests exercise.
 */

function mapRows(
  layout: FooterLayout,
  fn: (row: FooterLayoutRow) => FooterLayoutRow,
): FooterLayout {
  return { ...layout, rows: layout.rows.map(fn) };
}

function mapColumns(
  layout: FooterLayout,
  fn: (column: FooterLayoutColumn, row: FooterLayoutRow) => FooterLayoutColumn,
): FooterLayout {
  return mapRows(layout, (row) => ({
    ...row,
    columns: row.columns.map((column) => fn(column, row)),
  }));
}

/**
 * A reader coming from the header will look here for the step that grows the
 * column list to match a raised `columnCount`. There is none: a footer row
 * has no count, only its `columns` array, so tracks are added and removed
 * through `addColumn`/`removeColumn` and a patch can never claim more of
 * them than the row holds.
 */
export function patchRow(
  layout: FooterLayout,
  rowId: string,
  patch: Partial<FooterLayoutRow>,
): FooterLayout {
  return mapRows(layout, (row) => (row.id === rowId ? { ...row, ...patch } : row));
}

export function patchColumn(
  layout: FooterLayout,
  columnId: string,
  patch: Partial<FooterLayoutColumn>,
): FooterLayout {
  return mapColumns(layout, (column) =>
    column.id === columnId ? { ...column, ...patch } : column,
  );
}

export function patchItem(
  layout: FooterLayout,
  itemId: string,
  patch: Partial<FooterLayoutItem>,
): FooterLayout {
  return mapColumns(layout, (column) => ({
    ...column,
    items: column.items.map((item) =>
      item.id === itemId
        ? // The cast is the union's price: `patch` is a partial of one
          // variant, and only the caller (a typed panel) knows which.
          ({ ...item, ...patch } as FooterLayoutItem)
        : item,
    ),
  }));
}

export function addRow(layout: FooterLayout): FooterLayout {
  if (layout.rows.length >= MAX_FOOTER_ROWS) return layout;
  return { ...layout, rows: [...layout.rows, createFooterRow(3)] };
}

export function removeRow(layout: FooterLayout, rowId: string): FooterLayout {
  return { ...layout, rows: layout.rows.filter((row) => row.id !== rowId) };
}

export function moveRow(
  layout: FooterLayout,
  activeId: string,
  overId: string,
): FooterLayout {
  const from = layout.rows.findIndex((row) => row.id === activeId);
  const to = layout.rows.findIndex((row) => row.id === overId);
  if (from < 0 || to < 0 || from === to) return layout;
  const rows = [...layout.rows];
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return { ...layout, rows };
}

export function addColumn(layout: FooterLayout, rowId: string): FooterLayout {
  return mapRows(layout, (row) => {
    if (row.id !== rowId) return row;
    if (row.columns.length >= MAX_FOOTER_COLUMNS) return row;
    return { ...row, columns: [...row.columns, createFooterColumn()] };
  });
}

export function removeColumn(
  layout: FooterLayout,
  rowId: string,
  columnId: string,
): FooterLayout {
  return mapRows(layout, (row) => {
    if (row.id !== rowId) return row;
    // A row with no tracks has nothing to render into and no way back to one
    // from the canvas, so the last column stays; the row itself is removable.
    if (row.columns.length <= 1) return row;
    return { ...row, columns: row.columns.filter((column) => column.id !== columnId) };
  });
}

export function insertItem(
  layout: FooterLayout,
  columnId: string,
  item: FooterLayoutItem,
  index?: number,
): FooterLayout {
  return mapColumns(layout, (column) => {
    if (column.id !== columnId) return column;
    if (column.items.length >= MAX_FOOTER_ITEMS_PER_COLUMN) return column;
    const items = [...column.items];
    items.splice(index ?? items.length, 0, item);
    return { ...column, items };
  });
}

export function removeItem(
  layout: FooterLayout,
  itemId: string,
): FooterLayout {
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
  layout: FooterLayout,
  itemId: string,
  toColumnId: string,
  index?: number,
): FooterLayout {
  let moved: FooterLayoutItem | undefined;
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
  if (!target || target.items.length >= MAX_FOOTER_ITEMS_PER_COLUMN) {
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
  layout: FooterLayout,
  columnId: string,
): FooterLayoutColumn | null {
  return (
    layout.rows
      .flatMap((row) => row.columns)
      .find((column) => column.id === columnId) ?? null
  );
}

/**
 * An item is addressed by its id alone — the selection union carries no
 * column for it — so finding one means walking every column.
 */
export function findItem(
  layout: FooterLayout,
  itemId: string,
): FooterLayoutItem | null {
  return (
    layout.rows
      .flatMap((row) => row.columns)
      .flatMap((column) => column.items)
      .find((item) => item.id === itemId) ?? null
  );
}
