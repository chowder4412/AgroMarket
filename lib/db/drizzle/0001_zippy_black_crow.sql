CREATE TABLE "quotation_response_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer NOT NULL,
	"quotation_item_id" integer NOT NULL,
	"unit_price_ngn" integer NOT NULL,
	CONSTRAINT "quotation_response_items_response_id_quotation_item_id_unique" UNIQUE("response_id","quotation_item_id")
);
--> statement-breakpoint
ALTER TABLE "quotation_response_items" ADD CONSTRAINT "quotation_response_items_response_id_quotation_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."quotation_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_response_items" ADD CONSTRAINT "quotation_response_items_quotation_item_id_quotation_items_id_fk" FOREIGN KEY ("quotation_item_id") REFERENCES "public"."quotation_items"("id") ON DELETE restrict ON UPDATE no action;