import { z } from 'zod'

const schema = z.object({ key: z.string().max(255).nullish(), desktop: z.boolean().optional() })

/**
 * Estado del bloqueo para la app, al arrancar y al volver. Si el dispositivo tiene llave (se entró con
 * contraseña, o la sesión es de antes del bloqueo) y la sesión aún no lo sabía, la asocia a ella: eso
 * solo añade protección, y sin cambiar el último desbloqueo (una sesión antigua pide la huella ya).
 * También si es un ordenador («Siempre» espera más): solo con la sesión desbloqueada, así no abre una bloqueada
 */
export default defineEventHandler(async (event) => {
  const { key, desktop } = await readInput(event, schema)
  let status = await requireLockStatus(event)
  let deviceKey = true
  if (key && !status.bound) {
    // «1»: el dispositivo tiene llave pero no se sabe cuál
    const id = key === '1' ? '*' : key
    deviceKey = id === '*' ? status.keys.length > 0 : status.keys.includes(id)
    if (deviceKey) {
      await updateSessionLock(event, { key: id })
      status = await requireLockStatus(event)
    }
  }
  if (desktop !== undefined && !status.locked && desktop !== !!status.lock.desk) {
    await updateSessionLock(event, { desk: desktop })
    status = await requireLockStatus(event)
  }
  return { ...lockPayload(status), deviceKey }
})
