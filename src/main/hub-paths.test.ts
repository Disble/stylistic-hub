import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hubPaths } from './hub-paths'

describe('hubPaths', () => {
  it('keeps Pi state and the database side by side under userData', () => {
    const userData = join('C:', 'Users', 'writer', 'AppData', 'Roaming', 'Stylistic Hub')

    expect(hubPaths(userData)).toEqual({
      piDir: join(userData, 'pi'),
      database: join(userData, 'stylistic.db'),
      certificates: join(userData, 'certs'),
      caCert: join(userData, 'certs', 'ca.pem'),
      token: join(userData, 'hub-token')
    })
  })
})
