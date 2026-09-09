-- ============================================================================
-- Fixtures 00 — reference data
-- Values are from docs/13-config.md §1. TODO(decision) values stay NULL so the
-- code raises rather than shipping a silent default (13-config.md §2).
-- ============================================================================
set search_path = public, extensions;

-- ─── Market configuration ───────────────────────────────────────────────────
insert into market_config (
  market, currency, exponent, timezone, observes_dst, locales, default_locale,
  numerals_default, payment_methods, cash_enabled, default_commission_bp,
  vat_applies, vat_bp, vat_base, invoicing_mode, regulator_name,
  price_min_minor, price_max_minor, max_price_fraction,
  reservation_cap_default, reservation_cap_new_user, reservation_cap_cash,
  hold_duration_minutes, cancel_cutoff_hours, late_redeem_grace_minutes,
  undo_redeem_seconds, payout_cadence, payout_day, payout_min_minor,
  refund_cap_support_minor, adjustment_four_eyes_minor,
  cash_variance_threshold_minor, cash_liability_escalate_minor,
  cash_liability_escalate_days
) values
  ('KW','KWD',3,'Asia/Kuwait',false,
   '{en,ar-KW}'::locale_code[],'ar-KW','western',
   '{knet,apple_pay,card,cash}'::payment_method[], true, 2200,   -- cash enabled (D30)
   -- Kuwait: no VAT regime today. Decision 2 keeps the config, not a code path.
   false, null, null, 'platform_invoices_partner', 'PAFN',
   500, 15000, 0.50, 3, 2, 1, 10, 2, 30, 120, 'weekly', 0, 5000,
   20000, 50000, null, null, null),
  ('EG','EGP',2,'Africa/Cairo',true,
   '{en,ar-EG}'::locale_code[],'ar-EG','western',
   '{card,wallet,instapay,fawry,cash}'::payment_method[], true, 2200,
   -- Egypt: 14% VAT on the platform commission, platform e-invoices partners (D24).
   true, 1400, 'commission', 'platform_invoices_partner', 'NFSA',
   2500, 75000, 0.50, 3, 2, 1, 10, 2, 30, 120, 'weekly', 0, 25000,
   100000, 250000, 1000, 300000, 30);

-- D30/D35: cash thresholds for Kuwait, deletion clock and retention per market.
update market_config set cash_variance_threshold_minor = 500, cash_liability_escalate_minor = 100000, cash_liability_escalate_days = 30,
  deletion_clock_days = 30, financial_retention_years = 10, vat_effective_from = null where market = 'KW';
update market_config set deletion_clock_days = 30, financial_retention_years = 5, vat_effective_from = current_date where market = 'EG';

-- ─── Cities ─────────────────────────────────────────────────────────────────
insert into city (id, market, name_en, name_ar, governorate, stage, centroid, default_radius_m) values
  ('11111111-0000-4000-8000-000000000001','KW','Al Asimah','العاصمة','Al Asimah','live',
   st_setsrid(st_makepoint(47.9774,29.3759),4326)::geography, 6000),
  ('11111111-0000-4000-8000-000000000002','KW','Hawalli','حولي','Hawalli','live',
   st_setsrid(st_makepoint(48.0289,29.3328),4326)::geography, 5000),
  ('11111111-0000-4000-8000-000000000003','KW','Farwaniya','الفروانية','Farwaniya','live',
   st_setsrid(st_makepoint(47.9587,29.2775),4326)::geography, 6000),
  ('11111111-0000-4000-8000-000000000004','KW','Mubarak Al-Kabeer','مبارك الكبير','Mubarak Al-Kabeer','live',
   st_setsrid(st_makepoint(48.0733,29.2000),4326)::geography, 6000),
  ('11111111-0000-4000-8000-000000000005','KW','Ahmadi','الأحمدي','Ahmadi','live',
   st_setsrid(st_makepoint(48.0837,29.0769),4326)::geography, 9000),
  ('11111111-0000-4000-8000-000000000006','KW','Jahra','الجهراء','Jahra','live',
   st_setsrid(st_makepoint(47.6581,29.3375),4326)::geography, 9000),
  ('11111111-0000-4000-8000-000000000007','EG','Cairo','القاهرة','Cairo','live',
   st_setsrid(st_makepoint(31.2357,30.0444),4326)::geography, 12000),
  ('11111111-0000-4000-8000-000000000008','EG','Giza','الجيزة','Giza','live',
   st_setsrid(st_makepoint(31.2089,29.9870),4326)::geography, 10000),
  ('11111111-0000-4000-8000-000000000009','EG','Alexandria','الإسكندرية','Alexandria','live',
   st_setsrid(st_makepoint(29.9187,31.2001),4326)::geography, 10000),
  ('11111111-0000-4000-8000-00000000000a','EG','Qalyubia','القليوبية','Qalyubia','waitlist', null, 5000),
  ('11111111-0000-4000-8000-00000000000b','EG','Dakahlia','الدقهلية','Dakahlia','waitlist', null, 5000),
  ('11111111-0000-4000-8000-00000000000c','EG','Port Said','بورسعيد','Port Said','waitlist', null, 5000);

-- ─── Reason codes ───────────────────────────────────────────────────────────
-- Every controlled vocabulary the schema references by FK. ar-KW and ar-EG are
-- authored separately, never machine-translated between them (CLAUDE.md §13).
insert into reason_code (code, domain, label_en, label_ar_kw, label_ar_eg, requires_free_text) values
  ('sold_through_trade','listing_cancel','Sold through normal trade','انباع بالبيع العادي','اتباع بالبيع العادي',false),
  ('unexpected_closure','listing_cancel','Unexpected closure','إغلاق غير متوقع','قفل مفاجئ',false),
  ('staffing','listing_cancel','Staffing','نقص الموظفين','نقص عمالة',false),
  ('quality_concern','listing_cancel','Quality concern','تحفظ على الجودة','قلق بخصوص الجودة',false),
  ('listed_in_error','listing_cancel','Listed in error','أُدرج بالخطأ','اتضاف بالغلط',false),
  ('other','listing_cancel','Other','سبب آخر','سبب تاني',true),
  ('consumer_request','refund','Customer request','طلب العميل','طلب العميل',false),
  ('partner_cancelled','refund','Partner cancelled','إلغاء من المتجر','المتجر لغى',false),
  ('quality_issue','refund','Quality issue','مشكلة في الجودة','مشكلة في الجودة',false),
  ('never_received','refund','Not collected — store fault','لم يُستلم بسبب المتجر','مااستلمهاش بسبب المحل',false),
  ('goodwill','refund','Goodwill','بادرة حسن نية','بادرة حسن نية',true),
  ('duplicate_capture','refund','Duplicate charge','خصم مكرر','خصم مكرر',false),
  ('repeat_no_show','restriction','Repeated no-shows','عدم حضور متكرر','عدم حضور متكرر',false),
  ('suspected_abuse','restriction','Suspected abuse','اشتباه إساءة استخدام','اشتباه إساءة استخدام',true),
  ('licence_expired','partner_suspend','Food licence expired','انتهاء الرخصة الغذائية','انتهاء الرخصة الغذائية',false),
  ('safety_incident','partner_suspend','Food safety incident','حادثة سلامة غذائية','حادثة سلامة غذائية',true),
  ('doc_illegible','document_reject','Document illegible','المستند غير واضح','المستند مش واضح',false),
  ('doc_expired','document_reject','Document expired','المستند منتهي','المستند منتهي',false),
  ('doc_mismatch','document_reject','Details do not match','البيانات غير مطابقة','البيانات مش مطابقة',true),
  ('psp_reconciliation','adjustment','PSP reconciliation','تسوية مزود الدفع','تسوية مزود الدفع',true),
  ('cash_variance','adjustment','Cash variance','فرق في النقد','فرق في الكاش',true),
  ('manual_correction','adjustment','Manual correction','تصحيح يدوي','تصحيح يدوي',true),
  ('store_paused','store_pause','Temporarily paused','إيقاف مؤقت','وقف مؤقت',false);

-- ─── Document requirements (13-config.md §1) ────────────────────────────────
insert into market_document_requirement (market, doc_type, label_en, label_ar, per_store, requires_expiry, blocks_publishing_on_expiry) values
  ('KW','moci_licence','MOCI commercial licence','رخصة وزارة التجارة',false,true,false),
  ('KW','food_permit','Food permit','تصريح غذائي',true,true,true),
  ('KW','civil_id','Civil ID','البطاقة المدنية',false,true,false),
  ('KW','signatory_authorisation','Signatory authorisation','تفويض التوقيع',false,false,false),
  ('KW','bank_iban','Bank IBAN','الآيبان البنكي',false,false,false),
  ('EG','commercial_register','Commercial register extract','مستخرج السجل التجاري',false,true,false),
  ('EG','tax_card','Tax card','البطاقة الضريبية',false,true,false),
  ('EG','health_licence','Health licence','الرخصة الصحية',true,true,true),
  ('EG','national_id','National ID','الرقم القومي',false,true,false),
  ('EG','bank_or_wallet','Bank account or wallet','حساب بنكي أو محفظة',false,false,false);

-- ─── Holidays that suppress materialisation ─────────────────────────────────
-- Fixed-date only. Islamic dates move annually and are seeded per year with a
-- calendar reminder (13-config.md §1).
insert into market_holiday (market, holiday_date, name_en, name_ar) values
  ('KW','2027-02-25','National Day','اليوم الوطني'),
  ('KW','2027-02-26','Liberation Day','يوم التحرير'),
  ('EG','2027-01-07','Coptic Christmas','عيد الميلاد المجيد'),
  ('EG','2027-01-25','Revolution Day','عيد ثورة يناير'),
  ('EG','2027-04-25','Sinai Liberation Day','عيد تحرير سيناء'),
  ('EG','2027-05-01','Labour Day','عيد العمال'),
  ('EG','2027-06-30','30 June Revolution','ثورة 30 يونيو'),
  ('EG','2027-07-23','Revolution Day','عيد ثورة يوليو'),
  ('EG','2027-10-06','Armed Forces Day','عيد القوات المسلحة');

-- ─── Feature flags (13-config.md §1) ────────────────────────────────────────
insert into feature_flag (key, market, enabled, is_kill_switch) values
  ('reservations_enabled','KW',true,true),   ('reservations_enabled','EG',true,true),
  ('cash_on_pickup','KW',false,true),        ('cash_on_pickup','EG',true,true),
  ('psp_myfatoorah','KW',true,true),         ('psp_tap','KW',false,true),
  ('psp_paymob','EG',true,true),
  ('partner_onboarding','KW',true,true),     ('partner_onboarding','EG',true,true),
  ('push_notifications','KW',true,true),     ('push_notifications','EG',true,true),
  ('consumer_map_view','KW',true,false),     ('consumer_map_view','EG',true,false),
  ('partner_bulk_publish','KW',true,false),  ('partner_bulk_publish','EG',true,false),
  ('partner_pos_api','KW',false,false),      ('partner_pos_api','EG',false,false),
  ('consumer_hijri_dates','KW',false,false), ('consumer_hijri_dates','EG',false,false),
  ('wallet_topup','KW',false,false),         ('wallet_topup','EG',false,false);
