-- Тип citext для логинов и почты: регистр не важен, уникальность гарантирует БД.
-- Расширение доверенное (trusted), поэтому владельцу базы не нужен суперпользователь.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TABLE "academic_year" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"short_name" text,
	"birth_date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"actor_ip" "inet",
	"action" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"context" jsonb,
	"is_access" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"email" "citext",
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "guardian_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_user_id" uuid NOT NULL,
	"relation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"code" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	"scope" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "consent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_student_id" uuid,
	"subject_user_id" uuid,
	"guardian_user_id" uuid,
	"policy_version" text NOT NULL,
	"granted_via" text NOT NULL,
	"document_ref" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"ip" "inet",
	"details" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "period" ADD CONSTRAINT "period_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_link" ADD CONSTRAINT "guardian_link_guardian_user_id_app_user_id_fk" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_permission_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permission"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_subject_student_id_student_id_fk" FOREIGN KEY ("subject_student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_subject_user_id_app_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_guardian_user_id_app_user_id_fk" FOREIGN KEY ("guardian_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_acknowledged_by_app_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_year_idx" ON "period" USING btree ("academic_year_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guardian_link_student_idx" ON "guardian_link" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "guardian_link_user_idx" ON "guardian_link" USING btree ("guardian_user_id");--> statement-breakpoint
CREATE INDEX "consent_student_idx" ON "consent" USING btree ("subject_student_id");--> statement-breakpoint
CREATE INDEX "consent_guardian_idx" ON "consent" USING btree ("guardian_user_id");--> statement-breakpoint
CREATE INDEX "security_event_detected_idx" ON "security_event" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "security_event_kind_idx" ON "security_event" USING btree ("kind");--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;