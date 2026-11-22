import type { FormEvent, ReactNode } from 'react';
import type { CompanyInput, Contact, Owner, Prospect } from './model';
import { fieldValue } from './model';

export function Field({label, children}: {label: string; children: ReactNode}) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function OwnerSelect({owners, selected, placeholder}: {owners: Owner[]; selected?: string; placeholder: string}) {
  return <select name="ownerId" defaultValue={selected ?? ''}>
    <option value="">{placeholder}</option>
    {selected && !owners.some(owner => owner.id === selected) && <option value={selected}>Responsable anterior</option>}
    {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
  </select>;
}

const companyFields = [
  {name: 'name', label: 'Nombre comercial', max: 200, required: true},
  {name: 'sector', label: 'Rubro'}, {name: 'city', label: 'Ciudad'},
  {name: 'department', label: 'Departamento'}, {name: 'source', label: 'Origen'},
  {name: 'campaign', label: 'Campaña'}, {name: 'facebook', label: 'Facebook', max: 300},
  {name: 'instagram', label: 'Instagram', max: 300}, {name: 'website', label: 'Web', max: 300},
  {name: 'phone', label: 'Teléfono de empresa', type: 'tel', max: 40},
  {name: 'email', label: 'Correo de empresa', type: 'email', max: 254},
] as const;

export function CompanyForm({prospect, owners, busy, cancel, onSave}: {
  prospect?: Prospect; owners: Owner[]; busy: boolean; cancel: () => void;
  onSave: (value: CompanyInput) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(companyFields.map(({name}) => [name, fieldValue(form, name)]));
    onSave({...values, ownerId: fieldValue(form, 'ownerId') || undefined, notes: fieldValue(form, 'notes'),
      tags: fieldValue(form, 'tags').split(',').map(tag => tag.trim()).filter(Boolean),
      expectedVersion: prospect?.version});
  }
  return <section className="card">
    <div className="card-header"><h2>{prospect ? 'Editar empresa' : 'Nuevo prospecto'}</h2></div>
    <form className="stack" onSubmit={submit}>
      <fieldset className="form-grid" disabled={busy}>
        {companyFields.map(field => <Field key={field.name} label={field.label}>
          <input name={field.name} type={'type' in field ? field.type : 'text'} required={'required' in field}
            maxLength={'max' in field ? field.max : 150} defaultValue={prospect?.[field.name]} />
        </Field>)}
        <Field label="Responsable"><OwnerSelect owners={owners} selected={prospect?.ownerId} placeholder="Mi usuario"/></Field>
        <Field label="Etiquetas"><input name="tags" maxLength={1220} defaultValue={prospect?.tags.join(', ')} placeholder="Separadas por coma"/></Field>
        <Field label="Notas de empresa"><textarea name="notes" maxLength={3000} defaultValue={prospect?.notes} rows={2}/></Field>
      </fieldset>
      <div className="crm-actions">
        <button type="submit" className="button button-primary" disabled={busy}>Guardar empresa</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={cancel}>Cancelar</button>
      </div>
    </form>
  </section>;
}

export function ContactForm({contact, busy, cancel, onSave}: {
  contact?: Contact; busy: boolean; cancel: () => void; onSave: (value: object) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keys = ['name', 'jobTitle', 'phone', 'email', 'facebook', 'instagram', 'preferredChannel'];
    const form = new FormData(event.currentTarget);
    onSave({...Object.fromEntries(keys.map(key => [key, fieldValue(form, key)])),
      noContact: form.has('noContact'), expectedVersion: contact?.version});
  }
  return <form className="stack form-divider" onSubmit={submit}>
    <h3>{contact ? 'Editar contacto' : 'Nuevo contacto'}</h3>
    <fieldset className="form-grid" disabled={busy}>
      <Field label="Nombre del contacto"><input name="name" required maxLength={200} defaultValue={contact?.name}/></Field>
      <Field label="Cargo"><input name="jobTitle" maxLength={150} defaultValue={contact?.jobTitle}/></Field>
      <Field label="Teléfono del contacto"><input name="phone" type="tel" maxLength={40} defaultValue={contact?.phone ?? ''}/></Field>
      <Field label="Correo del contacto"><input name="email" type="email" maxLength={254} defaultValue={contact?.email ?? ''}/></Field>
      <Field label="Facebook del contacto"><input name="facebook" maxLength={300} defaultValue={contact?.facebook}/></Field>
      <Field label="Instagram del contacto"><input name="instagram" maxLength={300} defaultValue={contact?.instagram}/></Field>
      <Field label="Canal preferido"><select name="preferredChannel" defaultValue={contact?.preferredChannel ?? ''}>
        <option value="">Sin preferencia</option><option value="PHONE">Teléfono</option><option value="EMAIL">Correo</option>
        <option value="FACEBOOK">Facebook</option><option value="INSTAGRAM">Instagram</option>
      </select></Field>
      <label className="crm-actions"><input name="noContact" type="checkbox" defaultChecked={contact?.noContact}/>No contactar</label>
    </fieldset>
    <div className="crm-actions">
      <button className="button button-primary" disabled={busy}>Guardar contacto</button>
      <button type="button" className="button button-secondary" disabled={busy} onClick={cancel}>Cancelar</button>
    </div>
  </form>;
}
