use anchor_lang::prelude::*;

#[account]
pub struct TemplateConfig {
    pub template_count: u64,
    pub bump: u8,
}

impl TemplateConfig {
    pub const SIZE: usize = 8 + 8 + 1;
}
