import { describe, expect, test } from 'vitest';
import { eq } from '~/sql';
import { alias, index, integer, QueryBuilder, sqliteTable, text } from '~/sqlite-core';

const posts = sqliteTable('posts', {
	id: integer('id').primaryKey(),
	authorId: integer('author_id').notNull(),
	title: text('title').notNull(),
}, (t) => [index('posts_author_idx').on(t.authorId)]);

const comments = sqliteTable('comments', {
	id: integer('id').primaryKey(),
	postId: integer('post_id').notNull(),
}, (t) => [index('comments_post_idx').on(t.postId)]);

const postsAuthorIdx = index('posts_author_idx').on(posts.authorId);
const commentsPostIdx = index('comments_post_idx').on(comments.postId);

const qb = new QueryBuilder();

describe('sqlite index hints', () => {
	test('from: indexedBy with index builder', () => {
		const { sql } = qb.select({ id: posts.id }).from(posts, { indexedBy: postsAuthorIdx })
			.where(eq(posts.authorId, 1)).toSQL();

		expect(sql).toBe('select "id" from "posts" indexed by "posts_author_idx" where "posts"."author_id" = ?');
	});

	test('from: indexedBy with index name', () => {
		const { sql } = qb.select().from(posts, { indexedBy: 'posts_author_idx' }).toSQL();

		expect(sql).toBe('select "id", "author_id", "title" from "posts" indexed by "posts_author_idx"');
	});

	test('from: notIndexed', () => {
		const { sql } = qb.select({ id: posts.id }).from(posts, { notIndexed: true }).toSQL();

		expect(sql).toBe('select "id" from "posts" not indexed');
	});

	test('from: notIndexed: false adds no hint', () => {
		const { sql } = qb.select({ id: posts.id }).from(posts, { notIndexed: false }).toSQL();

		expect(sql).toBe('select "id" from "posts"');
	});

	test('from: aliased table puts the hint after the alias', () => {
		const p = alias(posts, 'p');
		const { sql } = qb.select({ id: p.id }).from(p, { indexedBy: postsAuthorIdx }).toSQL();

		expect(sql).toBe('select "id" from "posts" "p" indexed by "posts_author_idx"');
	});

	test('from: index name is escaped as identifier', () => {
		const { sql } = qb.select({ id: posts.id }).from(posts, { indexedBy: 'a"b' }).toSQL();

		expect(sql).toBe('select "id" from "posts" indexed by "a""b"');
	});

	test('from: both indexedBy and notIndexed throw', () => {
		expect(() => qb.select().from(posts, { indexedBy: postsAuthorIdx, notIndexed: true } as any)).toThrowError(
			'`indexedBy` and `notIndexed` index hints cannot be used together',
		);
	});

	test.each(['left', 'right', 'inner', 'full'] as const)('%s join: indexedBy', (type) => {
		const { sql } = qb.select({ id: posts.id, commentId: comments.id }).from(posts)
			[`${type}Join`](comments, eq(comments.postId, posts.id), { indexedBy: commentsPostIdx })
			.toSQL();

		expect(sql).toBe(
			`select "posts"."id", "comments"."id" from "posts" ${type} join "comments" indexed by "comments_post_idx" on "comments"."post_id" = "posts"."id"`,
		);
	});

	test('join: notIndexed', () => {
		const { sql } = qb.select({ id: posts.id, commentId: comments.id }).from(posts)
			.leftJoin(comments, eq(comments.postId, posts.id), { notIndexed: true })
			.toSQL();

		expect(sql).toBe(
			'select "posts"."id", "comments"."id" from "posts" left join "comments" not indexed on "comments"."post_id" = "posts"."id"',
		);
	});

	test('join: aliased table puts the hint after the alias', () => {
		const c = alias(comments, 'c');
		const { sql } = qb.select({ id: posts.id, commentId: c.id }).from(posts)
			.innerJoin(c, eq(c.postId, posts.id), { indexedBy: commentsPostIdx })
			.toSQL();

		expect(sql).toBe(
			'select "posts"."id", "c"."id" from "posts" inner join "comments" "c" indexed by "comments_post_idx" on "c"."post_id" = "posts"."id"',
		);
	});

	test('cross join: indexedBy', () => {
		const { sql } = qb.select({ id: posts.id, commentId: comments.id }).from(posts)
			.crossJoin(comments, { indexedBy: commentsPostIdx })
			.toSQL();

		expect(sql).toBe(
			'select "posts"."id", "comments"."id" from "posts" cross join "comments" indexed by "comments_post_idx"',
		);
	});

	test('hints on both the from table and joins', () => {
		const { sql } = qb.select({ id: posts.id, commentId: comments.id })
			.from(posts, { indexedBy: postsAuthorIdx })
			.innerJoin(comments, eq(comments.postId, posts.id), { indexedBy: commentsPostIdx })
			.where(eq(posts.authorId, 1))
			.toSQL();

		expect(sql).toBe(
			'select "posts"."id", "comments"."id" from "posts" indexed by "posts_author_idx" inner join "comments" indexed by "comments_post_idx" on "comments"."post_id" = "posts"."id" where "posts"."author_id" = ?',
		);
	});

	test('hint is kept in subqueries and set operators', () => {
		const sq = qb.select({ id: posts.id }).from(posts, { indexedBy: postsAuthorIdx }).as('sq');
		const { sql } = qb.select().from(sq).toSQL();

		expect(sql).toBe('select "id" from (select "id" from "posts" indexed by "posts_author_idx") "sq"');

		const { sql: unionSql } = qb.select({ id: posts.id }).from(posts, { indexedBy: postsAuthorIdx })
			.union(qb.select({ id: posts.id }).from(posts, { notIndexed: true }))
			.toSQL();

		expect(unionSql).toBe(
			'select "id" from (select "id" from "posts" indexed by "posts_author_idx" union select "id" from "posts" not indexed) "drizzle_union"',
		);
	});
});
