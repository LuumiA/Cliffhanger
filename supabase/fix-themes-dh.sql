-- Desperate Housewives : retire le thème « crime ».
update public.cards set themes = array['comedie','drame','amour'] where show = 'Desperate Housewives';
