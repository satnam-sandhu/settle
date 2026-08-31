-- Per-line paid_by and category_id on grouped expense children.
-- Parent expense_groups.paid_by / category_id stay denormalized from the first line (list header).
-- p_lines items may include { paid_by?: uuid, category_id?: uuid | null }. Missing paid_by falls back to p_paid_by.

CREATE OR REPLACE FUNCTION public.create_grouped_expense(
    p_group_id UUID,
    p_description TEXT,
    p_category_id UUID,
    p_paid_by UUID,
    p_currency TEXT DEFAULT 'INR',
    p_expense_date DATE DEFAULT CURRENT_DATE,
    p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_created_by UUID := auth.uid();
    v_expense_group_id UUID;
    v_line RECORD;
    v_line_description TEXT;
    v_line_amount DECIMAL(12, 2);
    v_line_notes TEXT;
    v_line_paid_by UUID;
    v_line_category_id UUID;
    v_split_between JSONB;
    v_user_id UUID;
    v_split_amount DECIMAL(12, 2);
    v_expense_id UUID;
    v_count INT;
BEGIN
    IF jsonb_array_length(p_lines) < 1 THEN
        RAISE EXCEPTION 'create_grouped_expense requires at least 1 line';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = p_group_id AND user_id = v_created_by
    ) THEN
        RAISE EXCEPTION 'Not a member of this group';
    END IF;

    INSERT INTO public.expense_groups (group_id, description, category_id, paid_by, created_by)
    VALUES (p_group_id, p_description, p_category_id, p_paid_by, v_created_by)
    RETURNING id INTO v_expense_group_id;

    FOR v_line IN SELECT elem FROM jsonb_array_elements(p_lines) AS elem
    LOOP
        v_line_description := v_line.elem->>'description';
        v_line_amount := (v_line.elem->>'amount')::DECIMAL(12, 2);
        v_line_notes := NULLIF(TRIM(v_line.elem->>'notes'), '');
        v_split_between := v_line.elem->'split_between';

        IF (v_line.elem ? 'paid_by') AND NULLIF(TRIM(v_line.elem->>'paid_by'), '') IS NOT NULL THEN
            v_line_paid_by := (v_line.elem->>'paid_by')::UUID;
        ELSE
            v_line_paid_by := p_paid_by;
        END IF;

        IF v_line.elem ? 'category_id' THEN
            IF NULLIF(TRIM(v_line.elem->>'category_id'), '') IS NULL THEN
                v_line_category_id := NULL;
            ELSE
                v_line_category_id := (v_line.elem->>'category_id')::UUID;
            END IF;
        ELSE
            v_line_category_id := p_category_id;
        END IF;

        IF v_line_description IS NULL OR v_line_description = '' THEN
            RAISE EXCEPTION 'Each line must have a description';
        END IF;
        IF v_line_amount IS NULL OR v_line_amount <= 0 THEN
            RAISE EXCEPTION 'Each line must have a positive amount';
        END IF;
        IF jsonb_array_length(v_split_between) IS NULL OR jsonb_array_length(v_split_between) < 1 THEN
            RAISE EXCEPTION 'Each line must have at least one user in split_between';
        END IF;

        v_count := jsonb_array_length(v_split_between);
        v_split_amount := ROUND((v_line_amount / v_count)::numeric, 2);

        INSERT INTO public.expenses (
            group_id,
            expense_group_id,
            paid_by,
            amount,
            currency,
            description,
            category_id,
            notes,
            expense_date,
            created_by
        ) VALUES (
            p_group_id,
            v_expense_group_id,
            v_line_paid_by,
            v_line_amount,
            p_currency,
            v_line_description,
            v_line_category_id,
            v_line_notes,
            p_expense_date,
            v_created_by
        )
        RETURNING id INTO v_expense_id;

        FOR v_user_id IN SELECT elem::UUID FROM jsonb_array_elements_text(v_split_between) AS elem
        LOOP
            INSERT INTO public.expense_splits (expense_id, user_id, amount)
            VALUES (v_expense_id, v_user_id, v_split_amount);
        END LOOP;
    END LOOP;

    RETURN v_expense_group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_grouped_expense(
    p_expense_group_id UUID,
    p_description TEXT,
    p_category_id UUID,
    p_paid_by UUID,
    p_currency TEXT DEFAULT 'INR',
    p_expense_date DATE DEFAULT CURRENT_DATE,
    p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_group_id UUID;
    v_line RECORD;
    v_line_description TEXT;
    v_line_amount DECIMAL(12, 2);
    v_line_notes TEXT;
    v_line_paid_by UUID;
    v_line_category_id UUID;
    v_split_between JSONB;
    v_user_id UUID;
    v_split_amount DECIMAL(12, 2);
    v_expense_id UUID;
    v_count INT;
BEGIN
    SELECT group_id INTO v_group_id
    FROM public.expense_groups
    WHERE id = p_expense_group_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'Expense group not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = v_group_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not a member of this group';
    END IF;

    IF jsonb_array_length(p_lines) < 1 THEN
        RAISE EXCEPTION 'update_grouped_expense requires at least 1 line';
    END IF;

    UPDATE public.expense_groups
    SET description = p_description,
        category_id = p_category_id,
        paid_by = p_paid_by,
        updated_at = NOW()
    WHERE id = p_expense_group_id;

    DELETE FROM public.expense_splits
    WHERE expense_id IN (SELECT id FROM public.expenses WHERE expense_group_id = p_expense_group_id);

    DELETE FROM public.expenses
    WHERE expense_group_id = p_expense_group_id;

    FOR v_line IN SELECT elem FROM jsonb_array_elements(p_lines) AS elem
    LOOP
        v_line_description := v_line.elem->>'description';
        v_line_amount := (v_line.elem->>'amount')::DECIMAL(12, 2);
        v_line_notes := NULLIF(TRIM(v_line.elem->>'notes'), '');
        v_split_between := v_line.elem->'split_between';

        IF (v_line.elem ? 'paid_by') AND NULLIF(TRIM(v_line.elem->>'paid_by'), '') IS NOT NULL THEN
            v_line_paid_by := (v_line.elem->>'paid_by')::UUID;
        ELSE
            v_line_paid_by := p_paid_by;
        END IF;

        IF v_line.elem ? 'category_id' THEN
            IF NULLIF(TRIM(v_line.elem->>'category_id'), '') IS NULL THEN
                v_line_category_id := NULL;
            ELSE
                v_line_category_id := (v_line.elem->>'category_id')::UUID;
            END IF;
        ELSE
            v_line_category_id := p_category_id;
        END IF;

        IF v_line_description IS NULL OR v_line_description = '' THEN
            RAISE EXCEPTION 'Each line must have a description';
        END IF;
        IF v_line_amount IS NULL OR v_line_amount <= 0 THEN
            RAISE EXCEPTION 'Each line must have a positive amount';
        END IF;
        IF jsonb_array_length(v_split_between) IS NULL OR jsonb_array_length(v_split_between) < 1 THEN
            RAISE EXCEPTION 'Each line must have at least one user in split_between';
        END IF;

        v_count := jsonb_array_length(v_split_between);
        v_split_amount := ROUND((v_line_amount / v_count)::numeric, 2);

        INSERT INTO public.expenses (
            group_id,
            expense_group_id,
            paid_by,
            amount,
            currency,
            description,
            category_id,
            notes,
            expense_date,
            created_by
        ) VALUES (
            v_group_id,
            p_expense_group_id,
            v_line_paid_by,
            v_line_amount,
            p_currency,
            v_line_description,
            v_line_category_id,
            v_line_notes,
            p_expense_date,
            auth.uid()
        )
        RETURNING id INTO v_expense_id;

        FOR v_user_id IN SELECT elem::UUID FROM jsonb_array_elements_text(v_split_between) AS elem
        LOOP
            INSERT INTO public.expense_splits (expense_id, user_id, amount)
            VALUES (v_expense_id, v_user_id, v_split_amount);
        END LOOP;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.create_grouped_expense IS 'Creates an expense_group and N child expenses with splits. p_lines: { description, amount, split_between, notes?, paid_by?, category_id? }. Allows 1+ lines. Line paid_by/category override parent when present.';
COMMENT ON FUNCTION public.update_grouped_expense IS 'Updates an expense_group and replaces all child expenses/splits. p_lines: { description, amount, split_between, notes?, paid_by?, category_id? }. Allows 1+ lines.';
