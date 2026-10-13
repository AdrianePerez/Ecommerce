import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input, Select } from './index'

describe('campos de formulário', () => {
  it('largura passada substitui a largura padrão (w-full)', () => {
    render(<><Input aria-label="valor" className="w-24" /><Select aria-label="unidade" className="w-24" /></>)
    for (const el of [screen.getByLabelText('valor'), screen.getByLabelText('unidade')]) {
      expect(el.className).toContain('w-24')
      expect(el.className).not.toContain('w-full')
    }
  })
  it('sem largura passada, o campo ocupa a largura toda', () => {
    render(<Input aria-label="nome" />)
    expect(screen.getByLabelText('nome').className).toContain('w-full')
  })
})
