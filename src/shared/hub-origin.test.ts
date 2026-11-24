import { describe, expect, it } from 'vitest'
import { HUB_ORIGIN, HUB_PORT, pointAtHub } from './hub-origin'

describe('hub origin', () => {
  it('stays off the ports development servers use by default', () => {
    expect(HUB_PORT).toBe(41730)
    expect(HUB_ORIGIN).toBe('https://localhost:41730')
  })
})

describe('pointAtHub', () => {
  it('moves every URL of the former origin, localhost:3000, to the hub origin', () => {
    const former =
      '<SupportUrl DefaultValue="https://localhost:3000"/><AppDomain>https://localhost:3000</AppDomain>' +
      '<SourceLocation DefaultValue="https://localhost:3000/m/x/taskpane.html"/>'

    expect(pointAtHub(former)).toBe(former.replaceAll('https://localhost:3000', 'https://localhost:41730'))
  })

  it('leaves a host or port that only starts with the former origin alone', () => {
    const other =
      '<AppDomain>https://localhost:30001</AppDomain><AppDomain>https://localhost:3000.example</AppDomain>'

    expect(pointAtHub(other)).toBe(other)
  })

  it('leaves a manifest already on the hub origin unchanged', () => {
    const current = '<SourceLocation DefaultValue="https://localhost:41730/m/x/taskpane.html"/>'

    expect(pointAtHub(current)).toBe(current)
  })
})
