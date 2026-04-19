/**
 * SMS Template Model
 * Handles template management and variable substitution
 */

const db = require('./db');

class SMSTemplate {
  /**
   * Create a new SMS template
   * @param {Object} options - { name, slug, content, description, variables, createdBy }
   * @returns {Object} Created template
   */
  static async create(options) {
    const {
      name,
      slug,
      content,
      description = null,
      variables = [],
      createdBy = null
    } = options;

    if (!name || !slug || !content) {
      throw new Error('Missing required fields: name, slug, content');
    }

    // Check for duplicate slug
    const existing = await db.query('SELECT id FROM sms_templates WHERE slug = $1', [slug]);
    if (existing.rows.length > 0) {
      throw new Error(`Template slug already exists: ${slug}`);
    }

    const result = await db.query(
      `INSERT INTO sms_templates (name, slug, content, description, variables, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, slug, content, description, variables, createdBy]
    );

    return result.rows[0];
  }

  /**
   * Get template by ID
   * @param {string} templateId - UUID of template
   * @returns {Object} Template
   */
  static async getById(templateId) {
    const result = await db.query(
      'SELECT * FROM sms_templates WHERE id = $1',
      [templateId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return result.rows[0];
  }

  /**
   * Get template by slug
   * @param {string} slug - Slug of template
   * @returns {Object} Template or null
   */
  static async getBySlug(slug) {
    const result = await db.query(
      'SELECT * FROM sms_templates WHERE slug = $1',
      [slug]
    );

    return result.rows[0] || null;
  }

  /**
   * List all templates
   * @param {boolean} includeDefault - Include default templates (default true)
   * @returns {Array} Templates
   */
  static async list(includeDefault = true) {
    let query = 'SELECT * FROM sms_templates';
    const params = [];

    if (!includeDefault) {
      query += ' WHERE is_default = FALSE';
    }

    query += ' ORDER BY is_default DESC, name ASC';

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * List only custom (non-default) templates
   * @returns {Array} Custom templates
   */
  static async listCustom() {
    const result = await db.query(
      'SELECT * FROM sms_templates WHERE is_default = FALSE ORDER BY name ASC'
    );
    return result.rows;
  }

  /**
   * List only default templates
   * @returns {Array} Default templates
   */
  static async listDefaults() {
    const result = await db.query(
      'SELECT * FROM sms_templates WHERE is_default = TRUE ORDER BY name ASC'
    );
    return result.rows;
  }

  /**
   * Update a template
   * @param {string} templateId - UUID of template
   * @param {Object} updates - { name, slug, content, description, variables }
   * @returns {Object} Updated template
   */
  static async update(templateId, updates) {
    const {
      name,
      slug,
      content,
      description,
      variables
    } = updates;

    // Get existing template first
    const template = await this.getById(templateId);

    // Check if slug is being changed to a duplicate
    if (slug && slug !== template.slug) {
      const existing = await db.query('SELECT id FROM sms_templates WHERE slug = $1', [slug]);
      if (existing.rows.length > 0) {
        throw new Error(`Template slug already exists: ${slug}`);
      }
    }

    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (slug !== undefined) {
      updateFields.push(`slug = $${paramCount++}`);
      values.push(slug);
    }
    if (content !== undefined) {
      updateFields.push(`content = $${paramCount++}`);
      values.push(content);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (variables !== undefined) {
      updateFields.push(`variables = $${paramCount++}`);
      values.push(variables);
    }

    if (updateFields.length === 0) {
      return template;
    }

    values.push(templateId);
    const query = `UPDATE sms_templates SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete a template
   * @param {string} templateId - UUID of template
   * @returns {boolean} Success
   */
  static async delete(templateId) {
    // Prevent deletion of default templates
    const template = await this.getById(templateId);
    if (template.is_default) {
      throw new Error('Cannot delete default templates');
    }

    const result = await db.query(
      'DELETE FROM sms_templates WHERE id = $1',
      [templateId]
    );

    return result.rowCount > 0;
  }

  /**
   * Render template with variables
   * @param {Object} template - Template object or { id, slug, content, variables }
   * @param {Object} data - Data object with variable values
   * @returns {Object} { content, warnings }
   */
  static async render(template, data = {}) {
    let content = template.content;
    const warnings = [];
    const usedVariables = new Set();

    // Extract variables from template
    const variableRegex = /\{\{(\w+)\}\}/g;
    let match;

    while ((match = variableRegex.exec(template.content)) !== null) {
      const variable = match[1];
      usedVariables.add(variable);

      if (data[variable] !== undefined) {
        content = content.replace(`{{${variable}}}`, String(data[variable]));
      } else {
        warnings.push(`Missing variable: {{${variable}}}`);
      }
    }

    return {
      content,
      warnings,
      usedVariables: Array.from(usedVariables)
    };
  }

  /**
   * Render template by slug
   * @param {string} slug - Template slug
   * @param {Object} data - Data object with variable values
   * @returns {Object} { content, warnings }
   */
  static async renderBySlug(slug, data = {}) {
    const template = await this.getBySlug(slug);
    if (!template) {
      throw new Error(`Template not found: ${slug}`);
    }

    return this.render(template, data);
  }

  /**
   * Get template variables
   * @param {Object} template - Template object or { content, variables }
   * @returns {Array} Variable names
   */
  static getVariables(template) {
    if (template.variables && Array.isArray(template.variables)) {
      return template.variables;
    }

    // Extract from content if not explicitly listed
    const variableRegex = /\{\{(\w+)\}\}/g;
    const variables = [];
    let match;

    while ((match = variableRegex.exec(template.content)) !== null) {
      const variable = match[1];
      if (!variables.includes(variable)) {
        variables.push(variable);
      }
    }

    return variables;
  }

  /**
   * Validate template syntax
   * @param {string} content - Template content
   * @returns {Object} { isValid, errors }
   */
  static validateSyntax(content) {
    const errors = [];
    const variableRegex = /\{\{(\w+)\}\}/g;
    let match;

    // Check for unmatched braces
    const openBraces = (content.match(/\{\{/g) || []).length;
    const closeBraces = (content.match(/\}\}/g) || []).length;

    if (openBraces !== closeBraces) {
      errors.push('Unmatched curly braces in template');
    }

    // Extract variable names
    const variables = [];
    while ((match = variableRegex.exec(content)) !== null) {
      const variable = match[1];
      if (!variables.includes(variable)) {
        variables.push(variable);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      variables
    };
  }
}

module.exports = SMSTemplate;
