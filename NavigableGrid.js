goog.provide('com.qwirx.grid.NavigableGrid');

goog.require('com.qwirx.grid.Grid');
goog.require('com.qwirx.grid.NavigationBar');
goog.require('com.qwirx.ui.BorderLayout');
goog.require('com.qwirx.ui.Renderer');
goog.require('goog.ui.Component');

/**
	@namespace
	@name com.qwirx.grid
*/

/**
 * A grid component with a built-in NavigationBar toolbar at the
 * bottom, linked to the grid's DataSource, which allows record
 * navigation.
 * @constructor
 */
com.qwirx.grid.NavigableGrid = function(datasource, opt_domHelper,
	opt_renderer)
{
	goog.base(this, datasource, opt_domHelper, opt_renderer ||
		com.qwirx.grid.NavigableGrid.RENDERER);
	this.nav_ = new com.qwirx.grid.NavigationBar(this.cursor_);
};

goog.inherits(com.qwirx.grid.NavigableGrid, com.qwirx.grid.Grid);

com.qwirx.grid.NavigableGrid.RENDERER =
	new com.qwirx.ui.Renderer(['com_qwirx_grid_NavigableGrid']);

/**
 * Allow Grid to construct its DOM, and then rearrange it to fit
 * into a table so that we can control element heights relative to
 * the container element.
 */
com.qwirx.grid.NavigableGrid.prototype.createDom = function()
{
	goog.base(this, 'createDom');
	this.layout_.addChild(this.nav_, true /* opt_render */, 'SOUTH');
};

/**
 * Add a bottom margin to the grid and the scrollbar, to make space
 * for the navigation bar, once we know its size.
 */
com.qwirx.grid.NavigableGrid.prototype.enterDocument = function()
{
	goog.base(this, 'enterDocument');
	this.nav_.setPageSize(this.getFullyVisibleRowCount());
};
