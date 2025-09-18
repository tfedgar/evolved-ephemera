<?php
/**
 * file to group functions relating to news
 */

/**
 * Disable the Gutenberg editor for news, since we use our own flexible content
 */
function Custom_disable_gutenberg($current_status, $post_type)
{
    if ($post_type === 'post') return false;
    return $current_status;
}
add_filter('use_block_editor_for_post_type', 'Custom_disable_gutenberg', 10, 2);