/**
 * Size limits for one product import file. Dependency-free so the import
 * dialog can check a file before uploading it, with the same numbers the
 * routes enforce.
 */
export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
