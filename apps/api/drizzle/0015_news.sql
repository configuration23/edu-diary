CREATE TABLE "news_image" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"uploaded_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published_on" timestamp with time zone DEFAULT now() NOT NULL,
	"visible_until" timestamp with time zone,
	"image_file_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
ALTER TABLE "news_image" ADD CONSTRAINT "news_image_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "news_image" ADD CONSTRAINT "news_image_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_deleted_by_app_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
/**
 * Индекс для выдачи новостей: список всегда идёт по дате показа от свежих.
 *
 * Частичный (`where deleted_at is null`): мягко удалённые не показываются никогда, и держать их в
 * индексе незачем — он остаётся компактным.
 */
CREATE INDEX "news_item_active_idx" ON "news_item" USING btree ("published_on" DESC NULLS LAST) WHERE "news_item"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "news_image_uploaded_by_idx" ON "news_image" USING btree ("uploaded_by");
