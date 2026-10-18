-- acard-i18n: the language a signed-in user picked (en, ko, zh). NULL means follow the cookie / country.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS lang text CHECK (lang IS NULL OR lang IN ('en', 'ko', 'zh'));
