import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const sessions=sqliteTable('sessions',{id:text('id').primaryKey(),csrf:text('csrf').notNull(),expires:integer('expires').notNull()});
export const limits=sqliteTable('limits',{id:text('id').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull()});
export const jobs=sqliteTable('jobs',{id:text('id').primaryKey(),owner:text('owner').notNull(),payload:text('payload'),status:text('status').notNull(),created:integer('created').notNull(),lease:integer('lease'),result:text('result')});
