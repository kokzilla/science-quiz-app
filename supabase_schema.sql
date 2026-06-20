-- ==========================================
-- Supabase Schema for Science Quiz Competition
-- SECURE INTERACTION VERSION FOR INTERNET-FACING DEPLOYMENT
-- ==========================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Rounds Table
create table if not exists rounds (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    date date not null default current_date,
    status text not null default 'pending', -- pending, active, completed
    revealed_question_number integer not null default 0, -- TV screen calculates answers <= this question
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Teams Table
create table if not exists teams (
    id uuid primary key default uuid_generate_v4(),
    round_id uuid references rounds(id) on delete cascade not null,
    team_number integer not null,
    name text not null,
    tie_breaker_score integer not null default 0, -- Manual points to resolve ties
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(round_id, team_number)
);

-- 3. Questions Table (Answer Key Setup)
create table if not exists questions (
    id uuid primary key default uuid_generate_v4(),
    round_id uuid references rounds(id) on delete cascade not null,
    question_number integer not null,
    correct_answer text not null, -- 'ก', 'ข', 'ค', 'ง'
    points integer not null default 1,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(round_id, question_number)
);

-- 4. Answers Table (Student Responses)
create table if not exists answers (
    id uuid primary key default uuid_generate_v4(),
    team_id uuid references teams(id) on delete cascade not null,
    question_number integer not null,
    submitted_answer text, -- 'ก', 'ข', 'ค', 'ง' (null for unanswered)
    is_correct boolean default false,
    recorded_by text,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(team_id, question_number)
);

-- 5. Private System Settings Table (Stores Passkeys)
create table if not exists system_settings (
    key text primary key,
    value text not null
);

-- Insert default passkeys (Change these values in Supabase SQL editor before deployment!)
insert into system_settings (key, value) values
('admin_passkey', 'admin123'),
('staff_passkey', 'staff123')
on conflict (key) do update set value = excluded.value;

-- Enable Realtime for tables (essential for TV live updates!)
do $$
begin
    -- Check for 'answers'
    if not exists (
        select 1 
        from pg_publication_rel pr
        join pg_class c on c.oid = pr.prrelid
        join pg_publication p on p.oid = pr.prpubid
        where p.pubname = 'supabase_realtime' and c.relname = 'answers'
    ) then
        alter publication supabase_realtime add table answers;
    end if;

    -- Check for 'teams'
    if not exists (
        select 1 
        from pg_publication_rel pr
        join pg_class c on c.oid = pr.prrelid
        join pg_publication p on p.oid = pr.prpubid
        where p.pubname = 'supabase_realtime' and c.relname = 'teams'
    ) then
        alter publication supabase_realtime add table teams;
    end if;

    -- Check for 'rounds'
    if not exists (
        select 1 
        from pg_publication_rel pr
        join pg_class c on c.oid = pr.prrelid
        join pg_publication p on p.oid = pr.prpubid
        where p.pubname = 'supabase_realtime' and c.relname = 'rounds'
    ) then
        alter publication supabase_realtime add table rounds;
    end if;
end;
$$;

-- ==========================================
-- ROW-LEVEL SECURITY (RLS) RULES
-- ==========================================
alter table rounds enable row level security;
alter table teams enable row level security;
alter table questions enable row level security;
alter table answers enable row level security;
alter table system_settings enable row level security; -- Private: No policy means forbidden for public select

-- Create Public Read Policies
drop policy if exists "Allow public read rounds" on rounds;
create policy "Allow public read rounds" on rounds for select using (true);

drop policy if exists "Allow public read teams" on teams;
create policy "Allow public read teams" on teams for select using (true);

drop policy if exists "Allow public read questions" on questions;
create policy "Allow public read questions" on questions for select using (true);

drop policy if exists "Allow public read answers" on answers;
create policy "Allow public read answers" on answers for select using (true);

-- No INSERT/UPDATE/DELETE policies are added for anon. Direct table writes will fail.

-- ==========================================
-- SECURE INTERFACE (SECURITY DEFINER RPCs)
-- ==========================================

-- A. Staff Answer Submission
create or replace function submit_answer_secure(
    p_team_id uuid,
    p_question_number integer,
    p_submitted_answer text,
    p_recorded_by text,
    p_staff_passkey text
)
returns void
security definer
language plpgsql
as $$
declare
    actual_key text;
begin
    -- Validate staff passkey
    select value into actual_key from system_settings where key = 'staff_passkey';
    if p_staff_passkey != actual_key then
        raise exception 'สิทธิ์ในการบันทึกข้อมูลไม่ถูกต้อง (Invalid Staff Passkey)';
    end if;

    -- Upsert answer
    insert into answers (team_id, question_number, submitted_answer, recorded_by)
    values (p_team_id, p_question_number, p_submitted_answer, p_recorded_by)
    on conflict (team_id, question_number)
    do update set 
        submitted_answer = excluded.submitted_answer,
        recorded_by = excluded.recorded_by,
        updated_at = now();
end;
$$;

-- B. Admin Manage Teams
create or replace function manage_team_secure(
    p_action text, -- 'insert', 'delete', 'tie_breaker'
    p_round_id uuid,
    p_team_number integer,
    p_name text,
    p_tie_breaker_score integer,
    p_team_id uuid,
    p_admin_passkey text
)
returns void
security definer
language plpgsql
as $$
declare
    actual_key text;
begin
    -- Validate admin passkey
    select value into actual_key from system_settings where key = 'admin_passkey';
    if p_admin_passkey != actual_key then
        raise exception 'สิทธิ์ผู้ดูแลระบบไม่ถูกต้อง (Invalid Admin Passkey)';
    end if;

    if p_action = 'insert' then
        insert into teams (round_id, team_number, name)
        values (p_round_id, p_team_number, p_name);
    elsif p_action = 'delete' then
        delete from teams where id = p_team_id;
    elsif p_action = 'tie_breaker' then
        update teams set tie_breaker_score = p_tie_breaker_score where id = p_team_id;
    elsif p_action = 'update_name' then
        update teams set name = p_name where id = p_team_id;
    end if;
end;
$$;

-- C. Admin Manage Correct Answer Keys
create or replace function manage_question_secure(
    p_question_id uuid,
    p_correct_answer text,
    p_admin_passkey text
)
returns void
security definer
language plpgsql
as $$
declare
    actual_key text;
begin
    select value into actual_key from system_settings where key = 'admin_passkey';
    if p_admin_passkey != actual_key then
        raise exception 'สิทธิ์ผู้ดูแลระบบไม่ถูกต้อง (Invalid Admin Passkey)';
    end if;

    update questions set correct_answer = p_correct_answer where id = p_question_id;
end;
$$;

-- D. Admin Manage Rounds
create or replace function manage_round_secure(
    p_action text, -- 'create', 'update_reveal', 'update_status', 'update_name', 'delete'
    p_round_name text,
    p_status text,
    p_reveal_q integer,
    p_round_id uuid,
    p_admin_passkey text
)
returns table (round_id uuid)
security definer
language plpgsql
as $$
declare
    actual_key text;
    new_id uuid;
begin
    select value into actual_key from system_settings where key = 'admin_passkey';
    if p_admin_passkey != actual_key then
        raise exception 'สิทธิ์ผู้ดูแลระบบไม่ถูกต้อง (Invalid Admin Passkey)';
    end if;

    if p_action = 'create' then
        new_id := uuid_generate_v4();
        insert into rounds (id, name, status, revealed_question_number)
        values (new_id, p_round_name, p_status, p_reveal_q);
        
        -- Auto-insert 20 questions for this round
        insert into questions (round_id, question_number, correct_answer)
        select new_id, q_num, 'ก'
        from generate_series(1, 20) as q_num;
        
        return query select new_id;
    elsif p_action = 'update_reveal' then
        update rounds set revealed_question_number = p_reveal_q where id = p_round_id;
        return query select p_round_id;
    elsif p_action = 'update_status' then
        update rounds set status = p_status where id = p_round_id;
        return query select p_round_id;
    elsif p_action = 'update_name' then
        update rounds set name = p_round_name where id = p_round_id;
        return query select p_round_id;
    elsif p_action = 'delete' then
        delete from rounds where id = p_round_id;
        return query select p_round_id;
    end if;
end;
$$;

-- ==========================================
-- Triggers for Automatic Scoring & Evaluation
-- ==========================================

-- Trigger to evaluate answer correctness on insert or update
create or replace function check_answer_correctness()
returns trigger as $$
declare
    correct_ans text;
    r_id uuid;
begin
    select round_id into r_id from teams where id = new.team_id;
    
    select correct_answer into correct_ans 
    from questions 
    where round_id = r_id and question_number = new.question_number;
    
    if new.submitted_answer is not null and correct_ans is not null then
        new.is_correct := (new.submitted_answer = correct_ans);
    else
        new.is_correct := false;
    end if;
    
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists tr_check_answer_correctness on answers;
create trigger tr_check_answer_correctness
before insert or update on answers
for each row
execute function check_answer_correctness();

-- Trigger to update answers if the admin edits the question answer key later
create or replace function update_answers_on_question_change()
returns trigger as $$
begin
    update answers
    set is_correct = (submitted_answer = new.correct_answer)
    where question_number = new.question_number
      and team_id in (select id from teams where round_id = new.round_id);
    return new;
end;
$$ language plpgsql;

drop trigger if exists tr_update_answers_on_question_change on questions;
create trigger tr_update_answers_on_question_change
after update on questions
for each row
execute function update_answers_on_question_change();

-- Helper RPC Function for Data Entry Progress
create or replace function get_answers_progress(r_id uuid)
returns table (
    question_number integer,
    submitted_count bigint
) as $$
begin
    return query
    select 
        q.question_number,
        count(a.id) as submitted_count
    from 
        questions q
    left join 
        teams t on t.round_id = q.round_id
    left join 
        answers a on a.team_id = t.id and a.question_number = q.question_number and a.submitted_answer is not null
    where 
        q.round_id = r_id
    group by 
        q.question_number
    order by 
        q.question_number;
end;
$$ language plpgsql;

-- E. Passkey Validation Helper
create or replace function validate_passkey(
    p_role text, -- 'admin' or 'staff'
    p_passkey text
)
returns boolean
security definer
language plpgsql
as $$
declare
    actual_key text;
begin
    if p_role = 'admin' then
        select value into actual_key from system_settings where key = 'admin_passkey';
        return p_passkey = actual_key;
    elsif p_role = 'staff' then
        select value into actual_key from system_settings where key = 'staff_passkey';
        return p_passkey = actual_key;
    else
        return false;
    end if;
end;
$$;

-- ==========================================================================
-- F. STAGE PRESENTER & QUESTION BANK MIGRATIONS
-- ==========================================================================

-- 1. Alter questions table to support text and slide-image questions
alter table questions 
add column if not exists question_text text,
add column if not exists choice_a text,
add column if not exists choice_b text,
add column if not exists choice_c text,
add column if not exists choice_d text,
add column if not exists is_image_only boolean not null default false,
add column if not exists question_image_url text,
add column if not exists answer_image_url text;

-- 2. Alter rounds table to support Stage Presenter state tracking
alter table rounds 
add column if not exists presenter_active_question integer not null default 1,
add column if not exists presenter_show_state text not null default 'question', -- 'question', 'timer_start', 'answer_revealed', 'correct_teams'
add column if not exists presenter_timer_started_at timestamp with time zone;

-- 3. Add secure RPC function to update presenter state with passkey validation
create or replace function update_presenter_state_secure(
    p_round_id uuid,
    p_active_question integer,
    p_show_state text,
    p_timer_started_at text, -- pass as ISO string or null
    p_passkey text
)
returns boolean
security definer
language plpgsql
as $$
declare
    admin_key text;
begin
    -- Verify Admin Passkey
    select value into admin_key from system_settings where key = 'admin_passkey';
    if p_passkey <> admin_key then
        raise exception 'รหัสผ่านแอดมินไม่ถูกต้อง!';
    end if;

    -- Update round presenter state
    update rounds
    set 
        presenter_active_question = p_active_question,
        presenter_show_state = p_show_state,
        presenter_timer_started_at = case when p_timer_started_at is not null then p_timer_started_at::timestamp with time zone else null end
    where id = p_round_id;

    return true;
end;
$$;

-- 4. Add secure RPC to update or insert a single question (for the manual editor)
create or replace function save_question_secure(
    p_round_id uuid,
    p_question_number integer,
    p_correct_answer text,
    p_is_image_only boolean,
    p_question_text text,
    p_choice_a text,
    p_choice_b text,
    p_choice_c text,
    p_choice_d text,
    p_question_image_url text,
    p_answer_image_url text,
    p_choices_layout text,
    p_passkey text
)
returns boolean
security definer
language plpgsql
as $$
declare
    admin_key text;
begin
    -- Verify Admin Passkey
    select value into admin_key from system_settings where key = 'admin_passkey';
    if p_passkey <> admin_key then
        raise exception 'รหัสผ่านแอดมินไม่ถูกต้อง!';
    end if;

    -- Insert or update question
    insert into questions (
        round_id, question_number, correct_answer, 
        is_image_only, question_text, choice_a, choice_b, choice_c, choice_d, 
        question_image_url, answer_image_url, choices_layout
    ) 
    values (
        p_round_id, p_question_number, p_correct_answer, 
        p_is_image_only, p_question_text, p_choice_a, p_choice_b, p_choice_c, p_choice_d, 
        p_question_image_url, p_answer_image_url, coalesce(p_choices_layout, '2_col')
    )
    on conflict (round_id, question_number) do update set
        correct_answer = excluded.correct_answer,
        is_image_only = excluded.is_image_only,
        question_text = excluded.question_text,
        choice_a = excluded.choice_a,
        choice_b = excluded.choice_b,
        choice_c = excluded.choice_c,
        choice_d = excluded.choice_d,
        question_image_url = excluded.question_image_url,
        answer_image_url = excluded.answer_image_url,
        choices_layout = excluded.choices_layout;

    return true;
end;
$$;

-- 5. Batch import questions secure
create or replace function import_questions_secure(
    p_round_id uuid,
    p_questions jsonb, -- array of question objects
    p_passkey text
)
returns boolean
security definer
language plpgsql
as $$
declare
    admin_key text;
    q_row jsonb;
begin
    -- Verify Admin Passkey
    select value into admin_key from system_settings where key = 'admin_passkey';
    if p_passkey <> admin_key then
        raise exception 'รหัสผ่านแอดมินไม่ถูกต้อง!';
    end if;

    -- Upsert loop
    for q_row in select * from jsonb_array_elements(p_questions) loop
        insert into questions (
            round_id, question_number, correct_answer, 
            is_image_only, question_text, choice_a, choice_b, choice_c, choice_d, 
            question_image_url, answer_image_url, choices_layout
        ) 
        values (
            p_round_id, 
            (q_row->>'question_number')::integer, 
            q_row->>'correct_answer', 
            (q_row->>'is_image_only')::boolean, 
            q_row->>'question_text', 
            q_row->>'choice_a', 
            q_row->>'choice_b', 
            q_row->>'choice_c', 
            q_row->>'choice_d', 
            q_row->>'question_image_url', 
            q_row->>'answer_image_url',
            coalesce(q_row->>'choices_layout', '2_col')
        )
        on conflict (round_id, question_number) do update set
            correct_answer = excluded.correct_answer,
            is_image_only = excluded.is_image_only,
            question_text = excluded.question_text,
            choice_a = excluded.choice_a,
            choice_b = excluded.choice_b,
            choice_c = excluded.choice_c,
            choice_d = excluded.choice_d,
            question_image_url = excluded.question_image_url,
            answer_image_url = excluded.answer_image_url,
            choices_layout = excluded.choices_layout;
    end loop;

    return true;
end;
$$;

-- 6. Add choices_layout column to questions table
alter table questions 
add column if not exists choices_layout text not null default '2_col';

-- Notify schema reload
notify pgrst, 'reload schema';


