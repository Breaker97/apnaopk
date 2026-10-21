"use client";
import { useState } from 'react';
/** Keep raw form text independent of the last valid paint, without delayed effects. */
export function useLastValidValue<T>(input: T,initial: T,resolve: (input:T,previous:T)=>T): T {
  const key=JSON.stringify(input);
  const [state,setState]=useState(()=>({key,value:resolve(input,initial)}));
  if (state.key !== key) {
    const next={key,value:resolve(input,state.value)};
    setState(next);
    return next.value;
  }
  return state.value;
}
