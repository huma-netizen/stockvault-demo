/* =========================================================
   StockVault — Categories views
   Simple CRUD list. Delete is blocked if any active product uses
   the category (the repository enforces this).
   ========================================================= */

import { el, openModal, confirmDialog, toast, formatCurrency, formatNumber } from '../ui.js';
import { categoriesRepo, productsRepo } from '../repositories.js';
import { loadSettings } from '../settings.js';
import { pageHeader, card, tableShell, field, readForm, setFieldError, clearFormErrors } from './_helpers.js';

export async function renderCategories(container) {
  const settings = await loadSettings();

  const root = el('div', { class: 'stack' });
  container.appendChild(root);

  root.appendChild(pageHeader({
    title: 'Categories',
    subtitle: 'Group products for filtering, reporting, and reorder suggestions.',
    actions: [
      el('button', { class: 'btn btn--primary', onclick: () => openCategoryForm({ onSaved: refresh }) }, '+ Add Category'),
    ],
  }));

  const host = el('div');
  root.appendChild(host);

  async function refresh() {
    host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'skeleton', style: { height: '200px' } })));

    const [cats, products, counts] = await Promise.all([
      categoriesRepo.list(),
      productsRepo.list({ includeArchived: true }),
      categoriesRepo.countProductsByCategory(),
    ]);

    // Aggregate inventory value per category.
    const valueByCat = {};
    const activeByCat = {};
    for (const p of products) {
      if (!p.categoryId) continue;
      valueByCat[p.categoryId] = (valueByCat[p.categoryId] || 0) + p.quantity * p.cost;
      if (!p.archived) activeByCat[p.categoryId] = (activeByCat[p.categoryId] || 0) + 1;
    }

    if (!cats.length) {
      host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty' }, [
        el('div', { class: 'empty__icon' }, '◇'),
        el('p', { class: 'empty__title' }, 'No categories yet'),
        el('p', { class: 'empty__text' }, 'Categories keep your products organised. Add one to get started.'),
        el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } }, [
          el('button', { class: 'btn btn--primary', onclick: () => openCategoryForm({ onSaved: refresh }) }, '+ Add Category'),
        ]),
      ])));
      return;
    }

    const shell = tableShell({
      columns: [
        { label: 'Name' },
        { label: 'Description' },
        { label: 'Products', class: 'col-num' },
        { label: 'Inventory value', class: 'col-num' },
        { label: 'Actions', class: 'col-actions' },
      ],
      rows: cats,
      renderRow: (c) => el('tr', {}, [
        el('td', { style: { fontWeight: '600' } }, c.name),
        el('td', { style: { color: 'var(--text-secondary)' } }, c.description || '—'),
        el('td', { class: 'col-num' }, formatNumber(activeByCat[c.id] || 0)),
        el('td', { class: 'col-num' }, formatCurrency(valueByCat[c.id] || 0, settings.currency)),
        el('td', { class: 'col-actions' }, el('div', { class: 'row-actions' }, [
          el('button', { class: 'icon-btn', title: 'Edit', onclick: () => openCategoryForm({ category: c, onSaved: refresh }) }, '✎'),
          el('button', { class: 'icon-btn', title: 'Delete', onclick: async () => {
            try {
              const ok = await confirmDialog({
                title: `Delete "${c.name}"?`,
                message: 'Categories can only be deleted if no products use them.',
                confirmLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
              await categoriesRepo.remove(c.id);
              toast('Category deleted.', { type: 'success' });
              refresh();
            } catch (err) {
              toast(err.message, { type: 'danger' });
            }
          } }, '🗑'),
        ])),
      ]),
    });
    host.replaceChildren(shell);
  }

  await refresh();
}

export async function openCategoryForm({ category = null, onSaved } = {}) {
  const isEdit = Boolean(category);
  const initial = category || { name: '', description: '' };

  const form = el('form', { class: 'form', novalidate: true }, [
    el('div', { class: 'form-grid' }, [
      field({ name: 'name', label: 'Category name', value: initial.name, required: true }),
    ]),
    el('div', { class: 'form-section' }, [
      field({ name: 'description', label: 'Description', type: 'textarea', value: initial.description, rows: 3 }),
    ]),
  ]);

  const { close } = openModal({
    title: isEdit ? `Edit ${category.name}` : 'Add Category',
    body: form,
    size: 'modal--sm',
    footer: [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => close() }, 'Cancel'),
      el('button', { class: 'btn btn--primary', type: 'submit' }, isEdit ? 'Save' : 'Create'),
    ],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors(form);
    const data = readForm(form);
    if (!data.name) { setFieldError(form, 'name', 'Name is required.'); return; }

    try {
      if (isEdit) await categoriesRepo.update(category.id, data);
      else        await categoriesRepo.create(data);
      toast(isEdit ? 'Category updated.' : 'Category created.', { type: 'success' });
      close();
      onSaved?.();
    } catch (err) {
      if (/name/i.test(err.message)) setFieldError(form, 'name', err.message);
      else toast(err.message, { type: 'danger' });
    }
  });
}