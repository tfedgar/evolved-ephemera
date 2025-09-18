<?php 
// Change preview links
function Custom_preview_link($preview_link, $post) {
  $frontend_url = get_field('frontend_url', 'options');
  $preview_secret = get_field('preview_secret', 'options');

  $preview_url = $preview_link;

  if ($frontend_url && $preview_secret) {
    $id = $post->ID;
    $preview_url = "$frontend_url/preview?secret=$preview_secret&id=$id";
  }

	return $preview_url;
}
add_filter( 'preview_post_link', 'Custom_preview_link', 10, 2 );