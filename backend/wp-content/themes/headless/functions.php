<?php
/**
 *
 * @package Custom Headless 
 */

/** Custom vars */
define( 'CMS_DOMAIN', get_field('cms_url', 'options') );
define( 'PREVIEW_URL', get_field('preview_url', 'options') );
define( 'FRONTEND_URL', get_field('frontend_url', 'options') );

require_once(__DIR__.'/functions/func-admin.php');
require_once(__DIR__.'/functions/func-setup.php');
require_once(__DIR__.'/functions/func-disable-comments.php');
require_once(__DIR__.'/functions/func-acf.php');
require_once(__DIR__.'/functions/func-build.php');
require_once(__DIR__.'/functions/func-news.php');
// require_once(__DIR__.'/functions/func-image-crop-fix.php');
require_once(__DIR__.'/functions/func-preview.php');