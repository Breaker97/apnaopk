/**
 * Application layers preserve earlier inline styles without leaking unmounted
 * owners. A value of "" REMOVES the property or attribute while the layer is
 * on (a setting the newer output no longer has), and its restore puts back
 * what was there before.
 */
type Layer = {
  parent?: Layer;
  active: boolean;
  vars: Record<string,string>;
  attributes: Record<string,string>;
  previousVars: Record<string,{value:string;priority:string}>;
  previousAttrs: Record<string,string|null>;
};
const owners = new WeakMap<HTMLElement,Layer>();
export function ownTheme(target:HTMLElement,vars:Record<string,string>,attributes:Record<string,string>={}) {
  const layer:Layer={
    parent:owners.get(target),active:true,vars,attributes,
    previousVars:Object.fromEntries(Object.keys(vars).map(k=>[k,{value:target.style.getPropertyValue(k),priority:target.style.getPropertyPriority(k)}])),
    previousAttrs:Object.fromEntries(Object.keys(attributes).map(k=>[k,target.getAttribute(k)])),
  };
  owners.set(target,layer);
  for (const [k,v] of Object.entries(vars)) target.style.setProperty(k,v);
  for (const [k,v] of Object.entries(attributes)) { if (v === "") target.removeAttribute(k); else target.setAttribute(k,v); }
  return () => {
    layer.active=false;
    if (owners.get(target)!==layer) return;
    let current:Layer|undefined=layer;
    // A previous owner may unmount while covered by preview. Restore its own
    // predecessor too; resurrecting its styles would leak them into the admin.
    while (current && !current.active) {
      for (const [k,v] of Object.entries(current.previousVars)) {
        if (target.style.getPropertyValue(k)!==current.vars[k]) continue;
        if (v.value) target.style.setProperty(k,v.value,v.priority);
        else target.style.removeProperty(k);
      }
      for (const [k,v] of Object.entries(current.previousAttrs)) {
        const ours = current.attributes[k] === "" ? null : current.attributes[k];
        if (target.getAttribute(k)!==ours) continue;
        if (v===null) target.removeAttribute(k);else target.setAttribute(k,v);
      }
      current=current.parent;
    }
    if (current) owners.set(target,current);else owners.delete(target);
  };
}
