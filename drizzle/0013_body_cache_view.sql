-- 지문(view)을 모르는 옛 행은 어느 메일함에서 담긴 것인지 알 수 없다.
-- 기본값 ''는 어떤 지문과도 같을 수 없어 적중하지는 않지만, 그렇다고 남겨 두면
-- 영영 안 쓰이는 본문이 30일 동안 디스크를 차지한다. 캐시라 지워도 잃는 것이 없다.
DELETE FROM `message_body_cache`;
--> statement-breakpoint
ALTER TABLE `message_body_cache` ADD `view` text DEFAULT '' NOT NULL;